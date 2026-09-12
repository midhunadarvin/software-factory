import { Annotation, Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { loadLatestArtifact, writeArtifact } from "../artifacts/store";
import {
  FunctionalRequirementsSchema,
  PullRequestDraftSchema,
  ReviewReportSchema,
  TaskGraphSchema,
  TechnicalSpecSchema,
  TriageReportSchema,
  triageFastTrack,
  type FunctionalRequirements,
  type ReviewReport,
  type TaskGraph,
  type TechnicalSpec,
  type TriageReport,
} from "../artifacts/schemas";
import { nextPending, nextStageAfterTask, resetFlaggedTasks } from "../artifacts/reset-flagged";
import { frMarkdown, frMdx, prMarkdown, reviewMarkdown, specMarkdown, specMdx } from "../artifacts/templates";
import { getDb } from "../db/client";
import { jobs } from "../db/schema";
import { commitProductChanges, productStatus } from "../git/branch";
import { runGit } from "../git/exec";
import { commitPrPrep, prepareFeatureBranch, publishPullRequest } from "./pull-request";
import { nowIso, checkpointsSqlitePath } from "../paths";
import { completeText, formatLlmError, getJobModel, getModel } from "./llm";
import { startSession, finishSession, stopSession } from "./session-store";
import { pushStream } from "./stream";
import { logEvent } from "./events";
import { wrapUntrusted } from "./untrusted";
import { runLaneObjectAgent } from "./lane-agent";
import { skillFor } from "./skills";
import { ticketTools } from "./ticket";
import { repoTools } from "./repo-tools";
import {
  contextFromFr,
  contextFromReview,
  contextFromSpec,
  contextFromTasks,
  contextFromTriage,
  formatContextBlock,
  loadLaneContext,
  writeLaneContext,
} from "./context";
import type { HitlResume } from "./types";
import { DEFAULT_PIPELINE } from "./pipeline/default";
import {
  firstActionOf,
  nextAction,
  nextLane,
  resolvePipeline,
  type ResolvedAction,
  type ResolvedPipeline,
} from "./pipeline";
import type { PipelineConfig } from "./pipeline/schema";

export const FactoryState = Annotation.Root({
  jobId: Annotation<string>(),
  projectId: Annotation<string>(),
  issueNumber: Annotation<number>(),
  // Last-write-wins: Command({ goto }) can re-trigger START in the same step as the dest node.
  stage: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  triage: Annotation<TriageReport | null>(),
  fr: Annotation<FunctionalRequirements | null>(),
  spec: Annotation<TechnicalSpec | null>(),
  tasks: Annotation<TaskGraph | null>(),
  review: Annotation<ReviewReport | null>(),
  fastTrack: Annotation<boolean>(),
  failedTaskId: Annotation<string | null>(),
  prUrl: Annotation<string | null>(),
  error: Annotation<string | null>(),
});

export type FactoryStateType = typeof FactoryState.State;

async function persistJob(jobId: string, patch: Record<string, unknown>) {
  await getDb()
    .update(jobs)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(jobs.id, jobId));
}

async function loadJob(jobId: string) {
  const rows = await getDb().select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return rows[0];
}

async function readTree(worktree: string, depth = 3, max = 400): Promise<string[]> {
  const out: string[] = [];
  const walk = (dir: string, d: number) => {
    if (out.length >= max || d > depth) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "node_modules" || e.name === ".factory") continue;
      const p = path.join(dir, e.name);
      const rel = path.relative(worktree, p);
      out.push(rel);
      if (out.length >= max) return;
      if (e.isDirectory()) walk(p, d + 1);
    }
  };
  walk(worktree, 0);
  return out;
}

function issueContext(job: { issueTitle: string; issueBody: string }) {
  return wrapUntrusted("issue", `${job.issueTitle}\n\n${job.issueBody}`);
}

function writeFactoryDoc(
  job: { issueNumber: number; worktreePath: string | null },
  filename: string,
  body: string,
) {
  if (!job.worktreePath) return;
  const dir = path.join(job.worktreePath, ".factory", "issues", String(Math.abs(job.issueNumber)));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), body);
}

async function loadFastTrack(jobId: string, fallback?: boolean): Promise<boolean> {
  if (fallback) return true;
  const row = await loadLatestArtifact(jobId, "triage");
  if (!row) return false;
  const parsed = TriageReportSchema.safeParse(row.parsed);
  return parsed.success ? parsed.data.fastTrack : false;
}

async function shouldSkipAction(
  action: ResolvedAction,
  state: FactoryStateType,
): Promise<boolean> {
  if (action.skipIf === "fast_track") return loadFastTrack(state.jobId, state.fastTrack);
  if (action.skipIf === "review_approved") return state.review?.verdict === "approve";
  return false;
}

function failedGateNode(action: ResolvedAction): string {
  return action.graphNode === "implementation" ? "implementation_failed_gate" : `${action.graphNode}_failed_gate`;
}

async function advanceFrom(
  state: FactoryStateType,
  resolved: ResolvedPipeline,
  node: string,
  patch: Partial<FactoryStateType>,
  pending?: unknown,
): Promise<Partial<FactoryStateType>> {
  const action = resolved.actionByNode.get(node);
  const lane = action ? resolved.laneById.get(action.laneId) : undefined;
  const next = nextAction(resolved, node);

  if (action?.handoff) {
    const nxtLane = lane ? nextLane(resolved, lane.id) : undefined;
    await persistJob(state.jobId, {
      state: nxtLane?.state ?? "done",
      lastActiveState: lane?.id ?? state.stage,
      boardColumn: nxtLane?.column ?? "done",
      pendingArtifact: pending != null ? JSON.stringify(pending) : undefined,
      ...(nxtLane?.queue === "impl" || nxtLane?.id === "implementation" ? { implStartedAt: nowIso() } : {}),
    });
    return { ...patch, stage: "handoff" };
  }

  if (next && next.type === "human_approval" && (await shouldSkipAction(next, { ...state, ...patch }))) {
    return advanceFrom(state, resolved, next.graphNode, patch, pending);
  }

  if (next?.type === "human_approval") {
    const nextLaneDef = resolved.laneById.get(next.laneId);
    await persistJob(state.jobId, {
      state: next.awaitingState ?? `awaiting_${next.laneId}_approval`,
      lastActiveState: next.laneId,
      boardColumn: nextLaneDef?.column ?? lane?.column,
      pendingArtifact: pending != null ? JSON.stringify(pending) : undefined,
    });
    await logEvent({
      projectId: state.projectId,
      jobId: state.jobId,
      event: "job.approval_needed",
      payload: { gate: next.gate ?? next.laneId },
    });
    return { ...patch, stage: next.graphNode };
  }

  if (next) {
    const nextLaneDef = resolved.laneById.get(next.laneId);
    await persistJob(state.jobId, {
      state: nextLaneDef?.state ?? next.laneId,
      lastActiveState: lane?.id ?? next.laneId,
      boardColumn: nextLaneDef?.column,
      pendingArtifact: pending != null ? JSON.stringify(pending) : undefined,
      ...(next.type === "implement" ? { implStartedAt: nowIso() } : {}),
    });
    return { ...patch, stage: next.graphNode };
  }

  await persistJob(state.jobId, {
    state: "done",
    lastActiveState: lane?.id ?? "done",
    boardColumn: resolved.lanes.find((l) => l.kind === "terminal")?.column ?? "done",
  });
  return { ...patch, stage: "done" };
}

async function triageDraft(
  state: FactoryStateType,
  resolved: ResolvedPipeline,
  node = "triage_draft",
) {
  const existing = await loadLatestArtifact(state.jobId, "triage");
  const job = await loadJob(state.jobId);
  if (!job) throw new Error("job missing");
  await persistJob(state.jobId, {
    state: "triage",
    lastActiveState: "triage",
    boardColumn: "triage",
  });
  let drafted: TriageReport;
  if (existing) {
    drafted = TriageReportSchema.parse(existing.parsed);
  } else {
    const tree = job.worktreePath ? await readTree(job.worktreePath) : [];
    const raw = await runLaneObjectAgent({
      lane: "triage",
      jobId: state.jobId,
      projectId: state.projectId,
      context: await loadLaneContext(state.jobId),
      schema: TriageReportSchema,
      userPrompt: `Triage this ticket. Every ticket still visits planning, tech spec, tasks, implementation, and PR. If simple and low risk, set fastTrack true so planning HITL auto-advances.\n${issueContext(job)}\nRepo tree:\n${wrapUntrusted("tree", tree.join("\n"))}`,
    });
    drafted = { ...raw, fastTrack: triageFastTrack(raw) };
    await writeArtifact({ jobId: state.jobId, kind: "triage", source: "agent", body: drafted });
    await writeLaneContext(state.jobId, contextFromTriage(drafted));
  }
  await logEvent({
    projectId: state.projectId,
    jobId: state.jobId,
    event: "lane.agent.end",
    payload: {
      lane: "triage",
      classification: drafted.classification,
      risk: drafted.risk,
      fastTrack: drafted.fastTrack,
    },
  });
  return advanceFrom(
    state,
    resolved,
    node,
    { triage: drafted, fastTrack: drafted.fastTrack },
    drafted,
  );
}

async function requirementsDraft(
  state: FactoryStateType,
  resolved: ResolvedPipeline,
  node = "requirements_draft",
) {
  const existing = await loadLatestArtifact(state.jobId, "fr");
  const job = await loadJob(state.jobId);
  if (!job) throw new Error("job missing");
  let drafted: FunctionalRequirements;
  if (existing) {
    drafted = FunctionalRequirementsSchema.parse(existing.parsed);
  } else {
    const tree = job.worktreePath ? await readTree(job.worktreePath) : [];
    drafted = await runLaneObjectAgent({
      lane: "requirements",
      jobId: state.jobId,
      projectId: state.projectId,
      context: await loadLaneContext(state.jobId),
      schema: FunctionalRequirementsSchema,
      userPrompt: `Create the planning spec for this ticket, then call requestHumanReview so the human gets Approve/Reject. Keep it short.\n${issueContext(job)}\nRepo tree:\n${wrapUntrusted("tree", tree.join("\n"))}`,
    });
    await writeArtifact({ jobId: state.jobId, kind: "fr", source: "agent", body: drafted });
    await writeLaneContext(state.jobId, contextFromFr(drafted));
  }
  writeFactoryDoc(job, "requirements.mdx", frMdx(drafted));
  writeFactoryDoc(job, "requirements.md", frMarkdown(drafted));
  return advanceFrom(state, resolved, node, { fr: drafted }, drafted);
}

async function requirementsGate(
  state: FactoryStateType,
  resolved: ResolvedPipeline,
  node = "requirements_gate",
) {
  const decision = interrupt({ gate: "requirements", artifact: state.fr }) as HitlResume;
  if (decision.action === "reject") return { stage: "rejected", fr: state.fr };
  const artifact = FunctionalRequirementsSchema.parse(
    "artifact" in decision ? decision.artifact : state.fr,
  );
  await writeLaneContext(state.jobId, contextFromFr(artifact));
  return advanceFrom(state, resolved, node, { fr: artifact }, artifact);
}

async function techSpecDraft(
  state: FactoryStateType,
  resolved: ResolvedPipeline,
  node = "tech_spec_draft",
) {
  const existing = await loadLatestArtifact(state.jobId, "tech_spec");
  const job = await loadJob(state.jobId);
  if (!job) throw new Error("job missing");
  let drafted: TechnicalSpec;
  if (existing) {
    drafted = TechnicalSpecSchema.parse(existing.parsed);
  } else {
    const tree = job.worktreePath ? await readTree(job.worktreePath) : [];
    drafted = await runLaneObjectAgent({
      lane: "tech_spec",
      jobId: state.jobId,
      projectId: state.projectId,
      context: await loadLaneContext(state.jobId),
      schema: TechnicalSpecSchema,
      userPrompt: `Write a technical specification for this change. Inspect the repo (inspectRepo, readFile). Then submitArtifact with a complete spec JSON, then finishLane.\nApproved FR:\n${JSON.stringify(state.fr)}\n${issueContext(job)}\nRepo tree:\n${wrapUntrusted("tree", tree.join("\n"))}`,
    });
    await writeArtifact({
      jobId: state.jobId,
      kind: "tech_spec",
      source: "agent",
      body: drafted,
    });
    await writeLaneContext(state.jobId, contextFromSpec(drafted));
  }
  writeFactoryDoc(job, "tech-spec.mdx", specMdx(drafted));
  writeFactoryDoc(job, "tech-spec.md", specMarkdown(drafted));
  return advanceFrom(state, resolved, node, { spec: drafted }, drafted);
}

async function techSpecGate(
  state: FactoryStateType,
  resolved: ResolvedPipeline,
  node = "tech_spec_gate",
) {
  const decision = interrupt({ gate: "tech_spec", artifact: state.spec }) as HitlResume;
  if (decision.action === "reject") return { stage: "rejected", spec: state.spec };
  const artifact = TechnicalSpecSchema.parse(
    "artifact" in decision ? decision.artifact : state.spec,
  );
  await writeLaneContext(state.jobId, contextFromSpec(artifact));
  return advanceFrom(state, resolved, node, { spec: artifact }, artifact);
}

async function tasksDraft(
  state: FactoryStateType,
  resolved: ResolvedPipeline,
  node = "tasks_draft",
) {
  const existing = await loadLatestArtifact(state.jobId, "task_graph");
  const job = await loadJob(state.jobId);
  if (!job) throw new Error("job missing");
  let drafted: TaskGraph;
  if (existing) {
    drafted = TaskGraphSchema.parse(existing.parsed);
  } else {
    drafted = await runLaneObjectAgent({
      lane: "tasks",
      jobId: state.jobId,
      projectId: state.projectId,
      context: await loadLaneContext(state.jobId),
      schema: TaskGraphSchema,
      userPrompt: `Break this spec into at most 40 tasks, then call submitArtifact with a tasks array ({ id: T-n, title, files, dependsOn, acceptance }). That exits the lane.\n${JSON.stringify(state.spec)}\nFR:\n${JSON.stringify(state.fr)}`,
    });
    await writeArtifact({
      jobId: state.jobId,
      kind: "task_graph",
      source: "agent",
      body: drafted,
    });
    await writeLaneContext(state.jobId, contextFromTasks(drafted));
  }
  return advanceFrom(state, resolved, node, { tasks: drafted }, drafted);
}

async function tasksGate(
  state: FactoryStateType,
  resolved: ResolvedPipeline,
  node = "tasks_gate",
) {
  const action = resolved.actionByNode.get(node);
  if (action && (await shouldSkipAction(action, state))) {
    const artifact = TaskGraphSchema.parse(state.tasks);
    await writeLaneContext(state.jobId, contextFromTasks(artifact));
    return advanceFrom(state, resolved, node, { tasks: artifact }, artifact);
  }
  const decision = interrupt({ gate: "tasks", artifact: state.tasks }) as HitlResume;
  if (decision.action === "reject") return { stage: "rejected", tasks: state.tasks };
  const artifact = TaskGraphSchema.parse(
    "artifact" in decision ? decision.artifact : state.tasks,
  );
  await writeLaneContext(state.jobId, contextFromTasks(artifact));
  return advanceFrom(state, resolved, node, { tasks: artifact }, artifact);
}

async function runOneTask(
  state: FactoryStateType,
  task: NonNullable<ReturnType<typeof nextPending>>,
): Promise<{ status: "done" | "failed"; tasks: TaskGraph; error?: string }> {
  const job = await loadJob(state.jobId);
  if (!job?.worktreePath) return { status: "failed", tasks: state.tasks!, error: "no worktree" };
  const worktree = job.worktreePath;
  const start = await runGit(["rev-parse", "HEAD"], { cwd: worktree });
  const startHead = start.stdout.trim();
  const model = getModel(state.jobId);
  const graph = {
    ...state.tasks!,
    tasks: state.tasks!.tasks.map((t) =>
      t.id === task.id ? { ...t, status: "in_progress" as const } : t,
    ),
  };
  await writeArtifact({ jobId: state.jobId, kind: "task_graph", source: "agent", body: graph });

  const mark = (status: "done" | "failed", error?: string) => {
    const next = {
      version: 1 as const,
      tasks: graph.tasks.map((t) => (t.id === task.id ? { ...t, status } : t)),
    };
    return { status, tasks: next, error };
  };

  if (!model) {
    return mark("failed", "Agent model is not configured");
  }

  try {
    const prior = await loadLaneContext(state.jobId);
    startSession(state.jobId, state.projectId, "implementation", getJobModel(state.jobId));
    await completeText({
      jobId: state.jobId,
      maxSteps: 20,
      system: `${skillFor("implementation")}\n\nEdit only the product files this task needs, gitCommit, then stop. A successful commit ends this task. Do not add .factory/ plans or specs.`,
      prompt: `${formatContextBlock(prior)}\n${wrapUntrusted("task", JSON.stringify(task))}\nFR: ${JSON.stringify(state.fr?.summary)}\nSpec modules: ${JSON.stringify(state.spec?.modules)}`,
      tools: {
        ...ticketTools(state.jobId),
        ...repoTools(worktree, {
          write: true,
          exec: true,
          onCommit: () => stopSession(state.jobId),
        }),
      },
      onPart: (part) => {
        pushStream({
          jobId: state.jobId,
          projectId: state.projectId,
          lane: "implementation",
          kind: part.type === "tool" ? "tool" : part.type === "thinking" ? "thinking" : "text",
          delta: part.delta,
          tool: part.tool,
        });
      },
    });
    finishSession(state.jobId, "done");
  } catch (err) {
    const message = formatLlmError(err);
    finishSession(state.jobId, "error", message);
    return mark("failed", message);
  }

  const dirty = await productStatus(worktree);
  if (dirty.trim()) {
    await commitProductChanges(worktree, `factory: ${task.id} ${task.title}`.slice(0, 72)).catch(
      () => false,
    );
  }
  const end = await runGit(["rev-parse", "HEAD"], { cwd: worktree });
  const leftover = await productStatus(worktree);
  if (leftover.trim()) {
    return mark("failed", leftover || "uncommitted files remain after the task");
  }
  if (end.stdout.trim() !== startHead) return mark("done");
  if (await filesAlreadyOnBranch(worktree, task.files)) return mark("done");
  return mark("failed", "task finished without a new commit");
}

async function filesAlreadyOnBranch(worktree: string, files: string[]): Promise<boolean> {
  if (!files.length) return false;
  const bases = ["@{upstream}", "origin/HEAD", "origin/main", "origin/master", "main", "master"];
  for (const base of bases) {
    const ok = await runGit(["rev-parse", "--verify", base], { cwd: worktree });
    if (ok.code !== 0) continue;
    const log = await runGit(["log", `${ok.stdout.trim()}..HEAD`, "--oneline", "--", ...files], {
      cwd: worktree,
    });
    if (log.stdout.trim()) return true;
  }
  return false;
}

async function implementationNode(state: FactoryStateType, resolved: ResolvedPipeline) {
  const implAction = resolved.lanes.flatMap((l) => l.actions).find((a) => a.type === "implement");
  const implLane = implAction ? resolved.laneById.get(implAction.laneId) : resolved.laneById.get("implementation");
  const afterImpl = implAction
    ? nextAction(resolved, implAction.graphNode)
    : firstActionOf(resolved, "review");
  const afterStage = afterImpl?.graphNode ?? "review_draft";
  const tasks = state.tasks;
  if (!tasks) return { stage: afterStage };
  const task = nextPending(tasks);
  if (!task) return { stage: afterStage };
  await persistJob(state.jobId, {
    state: implLane?.state ?? "implementation",
    lastActiveState: implLane?.id ?? "implementation",
    boardColumn: implLane?.column ?? "implementation",
  });
  let result = await runOneTask(state, task);
  if (result.status === "failed" && result.error !== "no worktree" && result.error !== "Agent model is not configured") {
    result = await runOneTask({ ...state, tasks: result.tasks }, task);
  }
  await writeArtifact({
    jobId: state.jobId,
    kind: "task_graph",
    source: "agent",
    body: result.tasks,
  });
  if (result.status === "failed") {
    await persistJob(state.jobId, {
      state: "failed",
      lastActiveState: "implementation",
      boardColumn: "implementation",
      error: result.error ?? "task failed",
    });
    return {
      stage: implAction ? failedGateNode(implAction) : "implementation_failed_gate",
      tasks: result.tasks,
      failedTaskId: task.id,
    };
  }
  const next = nextStageAfterTask(result.tasks);
  if (next === "implementation") {
    await persistJob(state.jobId, {
      state: implLane?.state ?? "implementation",
      lastActiveState: implLane?.id ?? "implementation",
      boardColumn: implLane?.column ?? "implementation",
    });
    return { stage: implAction?.graphNode ?? "implementation", tasks: result.tasks };
  }
  await writeLaneContext(state.jobId, contextFromTasks(result.tasks));
  if (implAction) {
    return advanceFrom(state, resolved, implAction.graphNode, { tasks: result.tasks }, result.tasks);
  }
  await persistJob(state.jobId, {
    state: "review",
    lastActiveState: "implementation",
    boardColumn: "pull_request",
  });
  return { stage: afterStage, tasks: result.tasks };
}

async function implementationFailedGate(state: FactoryStateType, resolved: ResolvedPipeline) {
  interrupt({ gate: "implementation_failed", taskId: state.failedTaskId });
  const latest = await loadLatestArtifact(state.jobId, "task_graph");
  const tasks = latest ? TaskGraphSchema.parse(latest.parsed) : state.tasks;
  const impl = resolved.lanes.flatMap((l) => l.actions).find((a) => a.type === "implement");
  const implLane = impl ? resolved.laneById.get(impl.laneId) : undefined;
  await persistJob(state.jobId, {
    state: implLane?.state ?? "implementation",
    lastActiveState: implLane?.id ?? "implementation",
    boardColumn: implLane?.column ?? "implementation",
    implStartedAt: nowIso(),
  });
  return { stage: impl?.graphNode ?? "implementation", tasks };
}

async function reviewDraft(
  state: FactoryStateType,
  resolved: ResolvedPipeline,
  node = "review_draft",
) {
  const existing = await loadLatestArtifact(state.jobId, "review");
  const job = await loadJob(state.jobId);
  if (!job) throw new Error("job missing");
  let drafted: ReviewReport;
  if (existing) {
    drafted = ReviewReportSchema.parse(existing.parsed);
  } else {
    let computedDiffs: { file: string; diff: string }[] = [];
    if (job.worktreePath) {
      computedDiffs = [{ file: "(all)", diff: await reviewDiff(job.worktreePath) }];
    }
    const object = await runLaneObjectAgent({
      lane: "review",
      jobId: state.jobId,
      projectId: state.projectId,
      context: await loadLaneContext(state.jobId),
      schema: ReviewReportSchema,
      userPrompt: `Review this implementation against the spec, then submitArtifact with summary, verdict, findings, filesChanged.\nSpec: ${JSON.stringify(state.spec)}\nTasks: ${JSON.stringify(state.tasks)}\nDiff:\n${wrapUntrusted("diff", computedDiffs[0]?.diff ?? "")}`,
    });
    drafted = { ...object, computedDiffs };
    await writeArtifact({ jobId: state.jobId, kind: "review", source: "agent", body: drafted });
    await writeLaneContext(state.jobId, contextFromReview(drafted));
  }
  return advanceFrom(state, resolved, node, { review: drafted }, drafted);
}

async function reviewGate(
  state: FactoryStateType,
  resolved: ResolvedPipeline,
  node = "review_gate",
) {
  const action = resolved.actionByNode.get(node);
  const decision = interrupt({ gate: action?.gate ?? "review", artifact: state.review }) as HitlResume;
  if (decision.action === "reject") return { stage: "rejected" };
  if (decision.action === "send_back") {
    const reset = resetFlaggedTasks(state.tasks!, state.review!);
    const allDone = reset.tasks.every((t) => t.status === "done");
    const nextTasks = allDone
      ? {
          ...reset,
          tasks: reset.tasks.map((t, i, a) =>
            i === a.length - 1 ? { ...t, status: "pending" as const } : t,
          ),
        }
      : reset;
    await writeArtifact({
      jobId: state.jobId,
      kind: "task_graph",
      source: "human",
      body: nextTasks,
    });
    const destId = action?.sendBackTo ?? "implementation";
    const dest = firstActionOf(resolved, destId);
    const destLane = resolved.laneById.get(destId);
    await persistJob(state.jobId, {
      state: destLane?.state ?? destId,
      lastActiveState: destLane?.id ?? destId,
      boardColumn: destLane?.column ?? "implementation",
      implStartedAt: nowIso(),
    });
    return { stage: dest?.graphNode ?? destId, tasks: nextTasks };
  }
  return advanceFrom(state, resolved, node, { review: state.review }, state.review);
}

async function pullRequestNode(
  state: FactoryStateType,
  resolved: ResolvedPipeline,
  node = "pull_request",
) {
  const job = await loadJob(state.jobId);
  if (!job) throw new Error("job missing");
  const { projects } = await import("../db/schema");
  const project = (
    await getDb().select().from(projects).where(eq(projects.id, job.projectId)).limit(1)
  )[0];
  if (!project) throw new Error("project missing");

  await persistJob(state.jobId, {
    state: "pull_request",
    lastActiveState: "pull_request",
    boardColumn: "pull_request",
  });

  let branch = job.branch;
  let branchNote = "no worktree";
  if (job.worktreePath) {
    const ensured = await prepareFeatureBranch({
      jobId: state.jobId,
      worktreePath: job.worktreePath,
      issueNumber: job.issueNumber,
      issueTitle: job.issueTitle,
      storedBranch: job.branch,
      defaultBranch: project.defaultBranch,
    });
    branch = ensured.branch;
    branchNote = ensured.created
      ? `was on ${ensured.previous} (not a feature branch); created ${ensured.branch}`
      : `already on feature branch ${ensured.branch}`;

    const n = Math.abs(job.issueNumber);
    const dir = path.join(job.worktreePath, ".factory", "issues", String(n));
    fs.mkdirSync(dir, { recursive: true });
    if (state.fr) {
      fs.writeFileSync(path.join(dir, "requirements.md"), frMarkdown(state.fr));
      fs.writeFileSync(
        path.join(dir, "requirements.visualplan.json"),
        JSON.stringify(state.fr.visualPlan, null, 2),
      );
    }
    if (state.spec) {
      fs.writeFileSync(path.join(dir, "tech-spec.md"), specMarkdown(state.spec));
      fs.writeFileSync(
        path.join(dir, "tech-spec.visualplan.json"),
        JSON.stringify(state.spec.visualPlan, null, 2),
      );
    }
    if (state.tasks) {
      fs.writeFileSync(path.join(dir, "tasks.json"), JSON.stringify(state.tasks, null, 2));
    }
    if (state.review) {
      fs.writeFileSync(path.join(dir, "review.json"), JSON.stringify(state.review, null, 2));
      fs.writeFileSync(path.join(dir, "review.md"), reviewMarkdown(state.review));
    }

    const existing = await loadLatestArtifact(state.jobId, "pr");
    let draft = existing
      ? PullRequestDraftSchema.safeParse(existing.parsed).success
        ? PullRequestDraftSchema.parse(existing.parsed)
        : null
      : null;
    if (!draft) {
      let diff = "";
      const against = await runGit(["diff", `${project.defaultBranch}...HEAD`, "--"], {
        cwd: job.worktreePath,
      }).catch(() => ({ stdout: "" }));
      diff = against.stdout || "";
      if (!diff.trim()) {
        const unstaged = await runGit(["diff", "HEAD", "--"], { cwd: job.worktreePath }).catch(
          () => ({ stdout: "" }),
        );
        diff = unstaged.stdout || "";
      }
      draft = await runLaneObjectAgent({
        lane: "pull_request",
        jobId: state.jobId,
        projectId: state.projectId,
        context: await loadLaneContext(state.jobId),
        schema: PullRequestDraftSchema,
        userPrompt: `Write a pull-request title and markdown body a human can review quickly.
The GitHub PR must include only the required product files from this ticket. Do not add, list as shipped, or describe factory working notes under .factory/ (requirements, tech spec, visual plans, tasks.json, review docs).
Branch: ${branch} (${branchNote}). Base: ${project.defaultBranch}.
Ticket: ${job.issueTitle}
${issueContext(job)}
FR: ${JSON.stringify(state.fr?.summary)}
Spec: ${JSON.stringify(state.spec?.summary)}
Tasks: ${JSON.stringify(state.tasks?.tasks.map((t) => `${t.id} ${t.title} (${t.status})`))}
Review: ${JSON.stringify(state.review?.summary)}
Diff:\n${wrapUntrusted("diff", diff.slice(0, 40_000))}`,
      });
      await writeArtifact({ jobId: state.jobId, kind: "pr", source: "agent", body: draft });
    }

    fs.writeFileSync(path.join(dir, "pull-request.md"), prMarkdown(draft.title, draft.body));
    await commitPrPrep(job.worktreePath, job.issueNumber);

    return advanceFrom(state, resolved, node, {}, draft);
  }

  return advanceFrom(state, resolved, node, { prUrl: null });
}

async function pullRequestGate(state: FactoryStateType, resolved: ResolvedPipeline) {
  const latest = await loadLatestArtifact(state.jobId, "pr");
  const stored = latest ? PullRequestDraftSchema.safeParse(latest.parsed) : null;
  const decision = interrupt({
    gate: "pull_request",
    artifact: stored?.success ? stored.data : latest?.parsed ?? null,
  }) as HitlResume;
  if (decision.action === "reject") return { stage: "rejected" };

  const job = await loadJob(state.jobId);
  if (!job) throw new Error("job missing");
  const draft = PullRequestDraftSchema.parse(
    "artifact" in decision && decision.artifact != null
      ? decision.artifact
      : stored?.success
        ? stored.data
        : { version: 1, title: job.issueTitle, body: job.issueBody || job.issueTitle },
  );
  if (latest) {
    await writeArtifact({ jobId: state.jobId, kind: "pr", source: "human", body: draft });
  }

  let published: { url: string | null; number: number | null } = { url: null, number: null };
  let publishError: string | null = null;
  if (!job.worktreePath || !job.branch) {
    publishError = `cannot open PR: missing ${!job.worktreePath ? "worktree" : "branch"}`;
  } else {
    const { projects } = await import("../db/schema");
    const project = (
      await getDb().select().from(projects).where(eq(projects.id, job.projectId)).limit(1)
    )[0];
    try {
      published = await publishPullRequest({
        jobId: state.jobId,
        projectId: state.projectId,
        worktreePath: job.worktreePath,
        branch: job.branch,
        defaultBranch: project?.defaultBranch ?? "main",
        title: draft.title,
        body: draft.body,
        draft: Boolean((decision as { draft?: boolean }).draft),
        issueNumber: job.issueNumber,
      });
    } catch (err) {
      publishError = err instanceof Error ? err.message : String(err);
    }
  }
  if (publishError) {
    await logEvent({
      projectId: state.projectId,
      jobId: state.jobId,
      level: "error",
      event: "job.pr_publish_failed",
      payload: {
        error: publishError,
        branch: job.branch,
        worktreePath: job.worktreePath,
        title: draft.title,
        draft: Boolean((decision as { draft?: boolean }).draft),
      },
    });
    finishSession(state.jobId, "error", publishError);
  }
  await persistJob(state.jobId, {
    state: publishError ? "failed" : "done",
    lastActiveState: publishError ? "pull_request" : "done",
    boardColumn: publishError ? "pull_request" : "done",
    prUrl: published.url,
    prNumber: published.number,
    pendingArtifact: JSON.stringify(draft),
    error: publishError,
  });
  return { stage: publishError ? "rejected" : "done", prUrl: published.url, error: publishError };
}

async function fixNode(
  state: FactoryStateType,
  resolved: ResolvedPipeline,
  node: string,
): Promise<Partial<FactoryStateType>> {
  const action = resolved.actionByNode.get(node);
  const lane = action ? resolved.laneById.get(action.laneId) : undefined;
  if (action && (await shouldSkipAction(action, state))) {
    return advanceFrom(state, resolved, node, {});
  }
  const job = await loadJob(state.jobId);
  if (!job) throw new Error("job missing");
  await persistJob(state.jobId, {
    state: lane?.state ?? action?.laneId ?? "review",
    lastActiveState: lane?.id ?? "review",
    boardColumn: lane?.column ?? "pull_request",
  });

  const review = state.review;
  const findings = review?.findings ?? [];
  if (!review || (review.verdict === "approve" && findings.length === 0)) {
    return advanceFrom(state, resolved, node, {});
  }

  if (job.worktreePath) {
    const worktree = job.worktreePath;
    startSession(state.jobId, state.projectId, "fix", getJobModel(state.jobId));
    try {
      await completeText({
        jobId: state.jobId,
        maxSteps: 20,
        system: `${skillFor("fix", action?.skill)}\n\nApply the review findings, gitCommit, then stop. Do not add .factory/ notes.`,
        prompt: `${formatContextBlock(await loadLaneContext(state.jobId))}\nReview:\n${JSON.stringify({
          verdict: review.verdict,
          summary: review.summary,
          findings,
        })}\nSpec: ${JSON.stringify(state.spec?.summary)}`,
        tools: {
          ...ticketTools(state.jobId),
          ...repoTools(worktree, {
            write: true,
            exec: true,
            onCommit: () => stopSession(state.jobId),
          }),
        },
        onPart: (part) => {
          pushStream({
            jobId: state.jobId,
            projectId: state.projectId,
            lane: "fix",
            kind: part.type === "tool" ? "tool" : part.type === "thinking" ? "thinking" : "text",
            delta: part.delta,
            tool: part.tool,
          });
        },
      });
      finishSession(state.jobId, "done");
    } catch (err) {
      finishSession(state.jobId, "error", formatLlmError(err));
      throw err;
    }
    const dirty = await productStatus(worktree);
    if (dirty.trim()) {
      await commitProductChanges(worktree, `factory: apply review findings`.slice(0, 72)).catch(() => false);
    }
  }
  return advanceFrom(state, resolved, node, {});
}

async function reviewDiff(worktree: string): Promise<string> {
  const tries = [
    ["diff", "HEAD~1", "--"],
    ["show", "--stat", "--patch", "--format=medium", "-1"],
    ["diff", "HEAD", "--"],
    ["log", "-5", "--oneline"],
  ];
  for (const args of tries) {
    const r = await runGit(args, { cwd: worktree }).catch(() => ({ stdout: "", code: 1 }));
    if ((r.stdout || "").trim()) return r.stdout.slice(0, 50_000);
  }
  return "(no diff — inspect files with gitDiff/readFile)";
}

function routeAfterNode(s: FactoryStateType): string {
  if (s.stage === "rejected" || s.stage === "handoff" || s.stage === "done") return END;
  return s.stage;
}

/** START must not always launch triage — Command({ goto }) re-enters START in the same step. */
export function routeFromStart(
  s: Pick<FactoryStateType, "stage">,
  resolved: ResolvedPipeline = resolvePipeline(DEFAULT_PIPELINE),
): string {
  const stage = s.stage;
  if (!stage || stage === resolved.firstAgentNode) return resolved.firstAgentNode;
  if (stage === "handoff" || stage === "done" || stage === "rejected") return END;
  if (resolved.graphNodes.includes(stage)) return stage;
  return resolved.firstAgentNode;
}

function handlerForAction(resolved: ResolvedPipeline, action: ResolvedAction) {
  const node = action.graphNode;
  if (action.type === "produce") {
    if (action.artifact === "triage") return (s: FactoryStateType) => triageDraft(s, resolved, node);
    if (action.artifact === "fr") return (s: FactoryStateType) => requirementsDraft(s, resolved, node);
    if (action.artifact === "tech_spec") return (s: FactoryStateType) => techSpecDraft(s, resolved, node);
    if (action.artifact === "task_graph") return (s: FactoryStateType) => tasksDraft(s, resolved, node);
    if (action.artifact === "review") return (s: FactoryStateType) => reviewDraft(s, resolved, node);
    if (action.artifact === "pr") return (s: FactoryStateType) => pullRequestNode(s, resolved, node);
  }
  if (action.type === "implement") return (s: FactoryStateType) => implementationNode(s, resolved);
  if (action.type === "fix") return (s: FactoryStateType) => fixNode(s, resolved, node);
  if (action.type === "human_approval") {
    if (action.gate === "requirements" || action.artifact === "fr") {
      return (s: FactoryStateType) => requirementsGate(s, resolved, node);
    }
    if (action.gate === "tech_spec" || action.artifact === "tech_spec") {
      return (s: FactoryStateType) => techSpecGate(s, resolved, node);
    }
    if (action.gate === "tasks" || action.artifact === "task_graph") {
      return (s: FactoryStateType) => tasksGate(s, resolved, node);
    }
    if (action.gate === "review" || action.artifact === "review") {
      return (s: FactoryStateType) => reviewGate(s, resolved, node);
    }
    if (action.gate === "pr" || action.artifact === "pr" || action.laneId === "pull_request") {
      return (s: FactoryStateType) => pullRequestGate(s, resolved);
    }
    return (s: FactoryStateType) => reviewGate(s, resolved, node);
  }
  if (action.type === "publish") {
    return (s: FactoryStateType) => pullRequestGate(s, resolved);
  }
  return async () => ({ stage: "handoff" });
}

function destMapFor(resolved: ResolvedPipeline, node: string): Record<string, string> {
  const dests = new Set<string>([END]);
  dests.add(node);
  const action = resolved.actionByNode.get(node);
  if (action) {
    let cursor: ResolvedAction | undefined = nextAction(resolved, node);
    while (cursor) {
      dests.add(cursor.graphNode);
      if (cursor.sendBackTo) {
        const back = firstActionOf(resolved, cursor.sendBackTo);
        if (back) dests.add(back.graphNode);
        dests.add(cursor.sendBackTo);
      }
      cursor = cursor.handoff ? undefined : nextAction(resolved, cursor.graphNode);
      if (dests.size > 24) break;
    }
    if (action.type === "implement") {
      dests.add(failedGateNode(action));
    }
    if (action.allowSendBack && action.sendBackTo) {
      const back = firstActionOf(resolved, action.sendBackTo);
      if (back) dests.add(back.graphNode);
    }
  }
  for (const n of resolved.graphNodes) dests.add(n);
  const map: Record<string, string> = { [END]: END };
  for (const d of dests) map[d] = d;
  return map;
}

export function compileFactoryGraph(
  checkpointer: SqliteSaver,
  pipeline: PipelineConfig = DEFAULT_PIPELINE,
) {
  const resolved = resolvePipeline(pipeline);
  // LangGraph's fluent types cannot express a dynamically built graph.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let g: any = new StateGraph(FactoryState);

  const added = new Set<string>();
  for (const action of resolved.lanes.flatMap((l) => l.actions)) {
    if (action.type === "publish") continue;
    if (added.has(action.graphNode)) continue;
    g = g.addNode(action.graphNode, handlerForAction(resolved, action));
    added.add(action.graphNode);
    if (action.type === "implement") {
      const failed = failedGateNode(action);
      if (!added.has(failed)) {
        g = g.addNode(failed, (s: FactoryStateType) => implementationFailedGate(s, resolved));
        added.add(failed);
      }
    }
  }

  const startPaths: Record<string, string> = { [END]: END };
  for (const n of resolved.graphNodes) startPaths[n] = n;
  startPaths[resolved.firstAgentNode] = resolved.firstAgentNode;

  g = g.addConditionalEdges(
    START,
    (s: FactoryStateType) => routeFromStart(s, resolved),
    startPaths,
  );

  for (const node of added) {
    const action = resolved.actionByNode.get(node);
    if (action?.type === "implement") {
      const failed = failedGateNode(action);
      g = g.addConditionalEdges(node, (s: FactoryStateType) => routeAfterNode(s), destMapFor(resolved, node));
      g = g.addEdge(failed, action.graphNode);
      continue;
    }
    if (node.endsWith("_failed_gate")) continue;
    g = g.addConditionalEdges(node, (s: FactoryStateType) => routeAfterNode(s), destMapFor(resolved, node));
  }

  return g.compile({ checkpointer });
}

export function openCheckpointer(): SqliteSaver {
  const p = checkpointsSqlitePath();
  const saver = (
    SqliteSaver as unknown as { fromConnString: (s: string) => SqliteSaver }
  ).fromConnString(p);
  return saver;
}

export { Command };
