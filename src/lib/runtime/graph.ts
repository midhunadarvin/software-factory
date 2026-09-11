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

async function triageDraft(state: FactoryStateType) {
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
  await persistJob(state.jobId, {
    state: "requirements",
    lastActiveState: "triage",
    boardColumn: "planning",
    pendingArtifact: JSON.stringify(drafted),
  });
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
  return { stage: "handoff", triage: drafted, fastTrack: drafted.fastTrack };
}

async function requirementsDraft(state: FactoryStateType) {
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
  await persistJob(state.jobId, {
    state: "awaiting_requirements_approval",
    lastActiveState: "requirements",
    boardColumn: "planning",
    pendingArtifact: JSON.stringify(drafted),
  });
  return { stage: "requirements_gate", fr: drafted };
}

async function requirementsGate(state: FactoryStateType) {
  const decision = interrupt({ gate: "requirements", artifact: state.fr }) as HitlResume;
  if (decision.action === "reject") return { stage: "rejected", fr: state.fr };
  const artifact = FunctionalRequirementsSchema.parse(
    "artifact" in decision ? decision.artifact : state.fr,
  );
  await writeLaneContext(state.jobId, contextFromFr(artifact));
  return { stage: "tech_spec_draft", fr: artifact };
}

async function techSpecDraft(state: FactoryStateType) {
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
  await persistJob(state.jobId, {
    state: "awaiting_tech_spec_approval",
    lastActiveState: "tech_spec",
    boardColumn: "tech_spec",
    pendingArtifact: JSON.stringify(drafted),
  });
  return { stage: "tech_spec_gate", spec: drafted };
}

async function techSpecGate(state: FactoryStateType) {
  const decision = interrupt({ gate: "tech_spec", artifact: state.spec }) as HitlResume;
  if (decision.action === "reject") return { stage: "rejected", spec: state.spec };
  const artifact = TechnicalSpecSchema.parse(
    "artifact" in decision ? decision.artifact : state.spec,
  );
  await writeLaneContext(state.jobId, contextFromSpec(artifact));
  return { stage: "tasks_draft", spec: artifact };
}

async function tasksDraft(state: FactoryStateType) {
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
  await persistJob(state.jobId, {
    state: "implementation",
    lastActiveState: "tasks",
    boardColumn: "implementation",
    pendingArtifact: JSON.stringify(drafted),
    implStartedAt: nowIso(),
  });
  return { stage: "handoff", tasks: drafted };
}

async function tasksGate(state: FactoryStateType) {
  if (await loadFastTrack(state.jobId, state.fastTrack)) {
    const artifact = TaskGraphSchema.parse(state.tasks);
    await writeLaneContext(state.jobId, contextFromTasks(artifact));
    await persistJob(state.jobId, { implStartedAt: nowIso() });
    return { stage: "implementation", tasks: artifact };
  }
  const decision = interrupt({ gate: "tasks", artifact: state.tasks }) as HitlResume;
  if (decision.action === "reject") return { stage: "rejected", tasks: state.tasks };
  const artifact = TaskGraphSchema.parse(
    "artifact" in decision ? decision.artifact : state.tasks,
  );
  await writeLaneContext(state.jobId, contextFromTasks(artifact));
  await persistJob(state.jobId, { implStartedAt: nowIso() });
  return { stage: "implementation", tasks: artifact };
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

async function implementationNode(state: FactoryStateType) {
  const tasks = state.tasks;
  if (!tasks) return { stage: "review_draft" };
  const task = nextPending(tasks);
  if (!task) return { stage: "review_draft" };
  await persistJob(state.jobId, {
    state: "implementation",
    lastActiveState: "implementation",
    boardColumn: "implementation",
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
    return { stage: "implementation_failed_gate", tasks: result.tasks, failedTaskId: task.id };
  }
  const next = nextStageAfterTask(result.tasks);
  if (next === "implementation") {
    await persistJob(state.jobId, {
      state: "implementation",
      lastActiveState: "implementation",
      boardColumn: "implementation",
    });
    return { stage: "implementation", tasks: result.tasks };
  }
  await writeLaneContext(state.jobId, contextFromTasks(result.tasks));
  await persistJob(state.jobId, {
    state: "review",
    lastActiveState: "implementation",
    boardColumn: "pull_request",
  });
  return { stage: "review_draft", tasks: result.tasks };
}

async function implementationFailedGate(state: FactoryStateType) {
  interrupt({ gate: "implementation_failed", taskId: state.failedTaskId });
  const latest = await loadLatestArtifact(state.jobId, "task_graph");
  const tasks = latest ? TaskGraphSchema.parse(latest.parsed) : state.tasks;
  await persistJob(state.jobId, {
    state: "implementation",
    lastActiveState: "implementation",
    boardColumn: "implementation",
    implStartedAt: nowIso(),
  });
  return { stage: "implementation", tasks };
}

async function reviewDraft(state: FactoryStateType) {
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
  if (await loadFastTrack(state.jobId, state.fastTrack)) {
    await persistJob(state.jobId, {
      state: "pull_request",
      lastActiveState: "review",
      boardColumn: "pull_request",
      pendingArtifact: JSON.stringify(drafted),
    });
    return { stage: "pull_request", review: drafted };
  }
  await persistJob(state.jobId, {
    state: "awaiting_review_approval",
    lastActiveState: "review",
    boardColumn: "pull_request",
    pendingArtifact: JSON.stringify(drafted),
  });
  await logEvent({
    projectId: state.projectId,
    jobId: state.jobId,
    event: "job.approval_needed",
    payload: { gate: "review" },
  });
  return { stage: "review_gate", review: drafted };
}

async function reviewGate(state: FactoryStateType) {
  const decision = interrupt({ gate: "review", artifact: state.review }) as HitlResume;
  if (decision.action === "reject") return { stage: "rejected" };
  if (decision.action === "send_back") {
    const reset = resetFlaggedTasks(state.tasks!, state.review!);
    const allDone = reset.tasks.every((t) => t.status === "done");
    const next = allDone
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
      body: next,
    });
    await persistJob(state.jobId, {
      state: "implementation",
      lastActiveState: "implementation",
      boardColumn: "implementation",
      implStartedAt: nowIso(),
    });
    return { stage: "implementation", tasks: next };
  }
  return { stage: "pull_request", review: state.review };
}

async function pullRequestNode(state: FactoryStateType) {
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

    await persistJob(state.jobId, {
      state: "awaiting_pr_approval",
      lastActiveState: "pull_request",
      boardColumn: "pull_request",
      pendingArtifact: JSON.stringify(draft),
      error: null,
    });
    await logEvent({
      projectId: state.projectId,
      jobId: state.jobId,
      event: "job.approval_needed",
      payload: { gate: "pr", document: "pull-request.md" },
    });
    return { stage: "pr_gate" };
  }

  await persistJob(state.jobId, {
    state: "awaiting_pr_approval",
    lastActiveState: "pull_request",
    boardColumn: "pull_request",
    prUrl: null,
  });
  return { stage: "pr_gate" };
}

async function pullRequestGate(state: FactoryStateType) {
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

function routeAfterGate(s: FactoryStateType) {
  return s.stage === "rejected" ? END : s.stage;
}

const GRAPH_NODES = [
  "triage_draft",
  "requirements_draft",
  "requirements_gate",
  "tech_spec_draft",
  "tech_spec_gate",
  "tasks_draft",
  "tasks_gate",
  "implementation",
  "implementation_failed_gate",
  "review_draft",
  "review_gate",
  "pull_request",
  "pr_gate",
] as const;

/** START must not always launch triage — Command({ goto }) re-enters START in the same step. */
export function routeFromStart(s: Pick<FactoryStateType, "stage">): string {
  const stage = s.stage;
  if (!stage || stage === "triage_draft") return "triage_draft";
  if (stage === "handoff" || stage === "done" || stage === "rejected") return END;
  if ((GRAPH_NODES as readonly string[]).includes(stage)) return stage;
  return "triage_draft";
}

const START_PATHS = {
  triage_draft: "triage_draft",
  requirements_draft: "requirements_draft",
  requirements_gate: "requirements_gate",
  tech_spec_draft: "tech_spec_draft",
  tech_spec_gate: "tech_spec_gate",
  tasks_draft: "tasks_draft",
  tasks_gate: "tasks_gate",
  implementation: "implementation",
  implementation_failed_gate: "implementation_failed_gate",
  review_draft: "review_draft",
  review_gate: "review_gate",
  pull_request: "pull_request",
  pr_gate: "pr_gate",
  [END]: END,
} as const;

export function compileFactoryGraph(checkpointer: SqliteSaver) {
  const g = new StateGraph(FactoryState)
    .addNode("triage_draft", triageDraft)
    .addNode("requirements_draft", requirementsDraft)
    .addNode("requirements_gate", requirementsGate)
    .addNode("tech_spec_draft", techSpecDraft)
    .addNode("tech_spec_gate", techSpecGate)
    .addNode("tasks_draft", tasksDraft)
    .addNode("tasks_gate", tasksGate)
    .addNode("implementation", implementationNode)
    .addNode("implementation_failed_gate", implementationFailedGate)
    .addNode("review_draft", reviewDraft)
    .addNode("review_gate", reviewGate)
    .addNode("pull_request", pullRequestNode)
    .addNode("pr_gate", pullRequestGate)
    .addConditionalEdges(START, routeFromStart, START_PATHS)
    .addConditionalEdges("triage_draft", (s) => (s.stage === "handoff" ? END : "requirements_draft"), {
      requirements_draft: "requirements_draft",
      [END]: END,
    })
    .addConditionalEdges("requirements_draft", (s) => (s.stage === "handoff" ? END : s.stage), {
      requirements_gate: "requirements_gate",
      [END]: END,
    })
    .addConditionalEdges("requirements_gate", routeAfterGate, {
      tech_spec_draft: "tech_spec_draft",
      [END]: END,
    })
    .addConditionalEdges("tech_spec_draft", (s) => (s.stage === "handoff" ? END : s.stage), {
      tech_spec_gate: "tech_spec_gate",
      [END]: END,
    })
    .addConditionalEdges("tech_spec_gate", routeAfterGate, {
      tasks_draft: "tasks_draft",
      [END]: END,
    })
    .addConditionalEdges("tasks_draft", (s) => (s.stage === "handoff" ? END : "tasks_gate"), {
      tasks_gate: "tasks_gate",
      [END]: END,
    })
    .addConditionalEdges("tasks_gate", routeAfterGate, {
      implementation: "implementation",
      [END]: END,
    })
    .addConditionalEdges("implementation", (s) => s.stage, {
      implementation: "implementation",
      review_draft: "review_draft",
      implementation_failed_gate: "implementation_failed_gate",
      handoff: END,
    })
    .addEdge("implementation_failed_gate", "implementation")
    .addConditionalEdges("review_draft", (s) => (s.stage === "handoff" ? END : s.stage), {
      review_gate: "review_gate",
      pull_request: "pull_request",
      [END]: END,
    })
    .addConditionalEdges("review_gate", (s) => s.stage, {
      pull_request: "pull_request",
      implementation: "implementation",
      rejected: END,
    })
    .addConditionalEdges("pull_request", (s) => (s.stage === "pr_gate" ? "pr_gate" : END), {
      pr_gate: "pr_gate",
      [END]: END,
    })
    .addConditionalEdges("pr_gate", (s) => (s.stage === "done" ? END : s.stage === "rejected" ? END : END), {
      [END]: END,
    });
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
