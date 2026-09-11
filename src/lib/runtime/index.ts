import { eq, and, isNull, sql, desc, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { getDb } from "../db/client";
import { artifacts, jobs, projects } from "../db/schema";
import { decryptPat } from "../crypto/pat";
import { addJobWorktree, branchName, removeJobWorktree } from "../git/worktree";
import { runGit } from "../git/exec";
import { gitEnvWithAskpass } from "../git/askpass";
import {
  addClaimedLabel,
  ensureLabels,
  listOpenFactoryIssues,
  searchFactoryIssues,
} from "../github/client";
import { nowIso, FACTORY_ROOT, invokePayloadPath } from "../paths";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadLatestArtifact, writeArtifact } from "../artifacts/store";
import {
  FunctionalRequirementsSchema,
  ReviewReportSchema,
  TaskGraphSchema,
  TechnicalSpecSchema,
  TriageReportSchema,
  type ArtifactKind,
  type TaskGraph,
} from "../artifacts/schemas";
import { resetFlaggedTasks } from "../artifacts/reset-flagged";
import { ingestWorkerLine, logEvent } from "./events";
import { compileFactoryGraph, openCheckpointer, type FactoryStateType } from "./graph";
import { acquirePidfile, isAlive, readDeadPid, releasePidfile } from "./pidfile";
import { RunQueue } from "./queue";
import type { HitlResume } from "./types";
import { assertAgentReady } from "./agent-status";
import { formatLlmError, getJobModel, setJobModel } from "./llm";
import {
  contextFromFr,
  contextFromSpec,
  contextFromTasks,
  contextFromTriage,
  writeLaneContext,
} from "./context";
import {
  graphNodeForState,
  isRunnableLaneState,
  RESTART_STEPS,
  type RestartStepId,
} from "./ticket";
import { stopSession, trimSessionsFromStep } from "./session-store";

type CompiledGraph = ReturnType<typeof compileFactoryGraph>;

const mutexes = new Map<string, Promise<void>>();

export class FactoryRuntime {
  graph: CompiledGraph | null = null;
  checkpointer: ReturnType<typeof openCheckpointer> | null = null;
  queue = new RunQueue();
  started = false;
  abort = new AbortController();
  liveInvokes = new Set<string>();
  workers = new Map<string, ChildProcess>();
  stopping = new Set<string>();
  pollers = new Map<string, NodeJS.Timeout>();
  reaper: NodeJS.Timeout | null = null;
  backoffUntil = new Map<string, number>();

  isJobRunning(jobId: string): boolean {
    const child = this.workers.get(jobId);
    if (child?.pid && child.exitCode === null) return true;
    return this.liveInvokes.has(jobId);
  }

  async startWorker() {
    if (this.started) return;
    this.started = true;
    this.checkpointer = openCheckpointer();
    this.graph = compileFactoryGraph(this.checkpointer);
  }

  async start() {
    if (this.started) return;
    acquirePidfile();
    this.started = true;
    this.checkpointer = openCheckpointer();
    this.graph = compileFactoryGraph(this.checkpointer);
    const dead = readDeadPid();
    if (dead) {
      await getDb()
        .update(jobs)
        .set({ lockedAt: null, lockedBy: null })
        .where(eq(jobs.lockedBy, String(dead)));
    }
    await this.recoverJobs();
    this.reaper = setInterval(() => {
      void this.recoverExpiredLeases();
    }, 30_000);
    await this.startPollers();
  }

  async stop() {
    this.abort.abort();
    this.abort = new AbortController();
    if (this.reaper) clearInterval(this.reaper);
    for (const t of this.pollers.values()) clearTimeout(t);
    this.pollers.clear();
    releasePidfile();
    this.started = false;
  }

  async withJobMutex<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
    const prev = mutexes.get(jobId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => {
      release = r;
    });
    mutexes.set(
      jobId,
      prev.then(() => next),
    );
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async getState(jobId: string) {
    if (!this.graph) throw new Error("runtime not started");
    return this.graph.getState({ configurable: { thread_id: jobId } });
  }

  hasInterrupt(snap: { tasks?: Array<{ interrupts?: unknown[] }> | Record<string, { interrupts?: unknown[] }> }): boolean {
    const tasks = snap.tasks;
    if (!tasks) return false;
    const list = Array.isArray(tasks) ? tasks : Object.values(tasks);
    return list.some((t) => (t.interrupts?.length ?? 0) > 0);
  }

  async invokeJob(
    job: typeof jobs.$inferSelect,
    kind: "first" | "continue" | "resume",
    resume?: HitlResume,
    update?: Partial<FactoryStateType>,
  ) {
    if (process.env.FACTORY_WORKER === "1") {
      return this.runGraph(job, kind, resume, update);
    }
    if (this.isJobRunning(job.id)) return;
    const generation = job.invokeGeneration + 1;
    await getDb()
      .update(jobs)
      .set({
        invokeGeneration: generation,
        lockedBy: String(process.pid),
        lockedAt: nowIso(),
        error: null,
      })
      .where(eq(jobs.id, job.id));
    const kindQueue =
      job.state === "implementation" || (kind === "resume" && resume?.action === "retry")
        ? "impl"
        : "planning";
    const release = await this.queue.acquire(kindQueue);
    this.liveInvokes.add(job.id);
    try {
      await this.spawnJobWorker(job, kind, resume, update);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
      if (code === "ENOENT") {
        await this.runGraph(job, kind, resume, update);
        return;
      }
      if (err instanceof Error && err.name === "GraphInterrupt") throw err;
      const message = formatLlmError(err);
      await getDb()
        .update(jobs)
        .set({ error: message, state: "failed", updatedAt: nowIso() })
        .where(eq(jobs.id, job.id));
      await logEvent({
        projectId: job.projectId,
        jobId: job.id,
        level: "error",
        event: "lane.agent.end",
        payload: { ok: false, error: message },
      });
      throw err;
    } finally {
      this.liveInvokes.delete(job.id);
      this.workers.delete(job.id);
      release();
      await getDb()
        .update(jobs)
        .set({ lockedAt: null, lockedBy: null, updatedAt: nowIso() })
        .where(eq(jobs.id, job.id));
    }
    if (process.env.FACTORY_WORKER !== "1" && !this.stopping.has(job.id)) {
      void this.maybeStartNextLane(job.id);
    }
  }

  async maybeStartNextLane(jobId: string) {
    const job = (await getDb().select().from(jobs).where(eq(jobs.id, jobId)))[0];
    if (!job || job.archivedAt) return;
    if (job.state.startsWith("awaiting_")) return;
    if (["done", "failed", "paused", "rejected", "intake", "inbox"].includes(job.state)) return;
    if (this.isJobRunning(jobId)) return;
    if (!isRunnableLaneState(job.state)) return;
    // HITL after planning and tech spec. Auto-continue triage→planning, tasks→impl, impl→review.
    const auto =
      (job.state === "requirements" && job.lastActiveState === "triage") ||
      job.state === "implementation" ||
      job.state === "review" ||
      job.state === "pull_request";
    if (!auto) return;
    void this.invokeJob(job, "continue");
  }

  async runGraph(
    job: typeof jobs.$inferSelect,
    kind: "first" | "continue" | "resume",
    resume?: HitlResume,
    update?: Partial<FactoryStateType>,
  ) {
    if (!this.graph) throw new Error("runtime not started");
    await getDb()
      .update(jobs)
      .set({ lockedBy: String(process.pid), lockedAt: nowIso() })
      .where(eq(jobs.id, job.id));
    const tuple = await this.checkpointer!.getTuple({ configurable: { thread_id: job.id } });
    const config = {
      configurable: { thread_id: job.id, invokeGeneration: job.invokeGeneration },
      signal: this.abort.signal,
    };
    try {
      if (kind === "resume") {
        return await this.graph.invoke(new Command({ resume, update }), config);
      }
      const dest = graphNodeForState(job.state);
      if (!dest) return null;
      if (!tuple) {
        const seed = await seedFactoryState(job, dest);
        if (dest === "triage_draft") {
          return await this.graph.invoke({ ...seed, ...update }, config);
        }
        return await this.graph.invoke(new Command({ goto: dest, update: { ...seed, ...update } }), config);
      }
      return await this.graph.invoke(new Command({ goto: dest, update }), config);
    } catch (err) {
      if (err instanceof Error && (err.name === "GraphInterrupt" || err.name === "AbortError")) {
        return null;
      }
      const message = formatLlmError(err);
      await getDb()
        .update(jobs)
        .set({ error: message, state: "failed", updatedAt: nowIso() })
        .where(eq(jobs.id, job.id));
      await logEvent({
        projectId: job.projectId,
        jobId: job.id,
        level: "error",
        event: "lane.agent.end",
        payload: { ok: false, error: message },
      });
      throw err;
    }
  }

  private spawnJobWorker(
    job: typeof jobs.$inferSelect,
    kind: "first" | "continue" | "resume",
    resume?: HitlResume,
    update?: Partial<FactoryStateType>,
  ): Promise<void> {
    const payloadPath = invokePayloadPath(job.id);
    fs.writeFileSync(payloadPath, JSON.stringify({ kind, resume, update: update ?? null }));
    const script = path.join(FACTORY_ROOT, "src/scripts/run-job.ts");
    const child = spawn(process.execPath, [...process.execArgv, script, job.id], {
      cwd: FACTORY_ROOT,
      env: { ...process.env, FACTORY_WORKER: "1", FACTORY_ROOT },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.workers.set(job.id, child);
    let stderr = "";
    let stdoutBuf = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });
    child.stdout?.on("data", (chunk) => {
      stdoutBuf += String(chunk);
      let nl = stdoutBuf.indexOf("\n");
      while (nl >= 0) {
        const line = stdoutBuf.slice(0, nl);
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!ingestWorkerLine(line) && line.trim()) process.stdout.write(`${line}\n`);
        nl = stdoutBuf.indexOf("\n");
      }
    });
    return new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => {
        try {
          fs.unlinkSync(payloadPath);
        } catch {
          /* ignore */
        }
        if (this.stopping.has(job.id) || code === 0 || code === null || code === 143) {
          resolve();
          return;
        }
        // Node 22+ exits 13 when a top-level await is still pending; tsx prints that
        // warning on SIGTERM too. Neither should fail the ticket.
        if (code === 13 || /unsettled top-level await/i.test(stderr)) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || `agent worker exited ${code}`));
      });
    });
  }

  async resume(jobId: string, resume: HitlResume, update?: Partial<FactoryStateType>) {
    const job = (await getDb().select().from(jobs).where(eq(jobs.id, jobId)))[0];
    if (!job) throw new Error("job not found");
    return this.invokeJob(job, "resume", resume, update);
  }

  async retryLane(jobId: string) {
    const job = (await getDb().select().from(jobs).where(eq(jobs.id, jobId)))[0];
    if (!job) throw new Error("job not found");
    if (job.archivedAt) throw new Error("job is deleted");
    if (this.isJobRunning(jobId)) return { alreadyRunning: true };
    if (job.state === "failed" && job.lastActiveState === "implementation") {
      return retryImplementation(jobId);
    }
    const resumeState = job.state === "failed" ? job.lastActiveState || "triage" : job.state;
    await getDb()
      .update(jobs)
      .set({ error: null, state: resumeState, updatedAt: nowIso() })
      .where(eq(jobs.id, jobId));
    const tuple = await this.checkpointer?.getTuple({ configurable: { thread_id: jobId } });
    return this.invokeJob({ ...job, state: resumeState, error: null }, tuple ? "continue" : "first");
  }

  async recoverJobs() {
    const rows = await getDb()
      .select()
      .from(jobs)
      .where(and(isNull(jobs.archivedAt)));
    for (const job of rows) {
      if (["paused", "rejected", "done", "intake", "inbox"].includes(job.state)) continue;
      if (job.state === "failed" && job.lastActiveState !== "implementation") continue;
      if (this.isJobRunning(job.id)) continue;
      if (job.lockedBy && isAlive(Number(job.lockedBy))) continue;
      await this.recoverOne(job);
    }
  }

  private async recoverOne(job: typeof jobs.$inferSelect) {
    const tuple = await this.checkpointer?.getTuple({ configurable: { thread_id: job.id } });
    const snap = tuple
      ? await this.graph!.getState({ configurable: { thread_id: job.id } })
      : null;
    const waiting =
      job.state.startsWith("awaiting_") ||
      (job.state === "failed" && job.lastActiveState === "implementation");
    const hasInterrupt = snap ? this.hasInterrupt(snap) : false;
    if (waiting && hasInterrupt) return;
    if (waiting && !hasInterrupt) {
      void this.invokeJob(job, tuple ? "continue" : "first");
      return;
    }
    if (
      [
        "triage",
        "requirements",
        "tech_spec",
        "tasks",
        "implementation",
        "review",
        "pull_request",
      ].includes(job.state)
    ) {
      void this.invokeJob(job, tuple ? "continue" : "first");
    }
  }

  private async recoverExpiredLeases() {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const stale = await getDb().select().from(jobs).where(sql`locked_at IS NOT NULL AND locked_at < ${cutoff}`);
    for (const job of stale) {
      if (this.liveInvokes.has(job.id)) continue;
      await getDb()
        .update(jobs)
        .set({ lockedAt: null, lockedBy: null })
        .where(eq(jobs.id, job.id));
      await this.recoverOne(job);
    }
  }

  async createLocalJob(projectId: string, title: string, body: string) {
    const project = (await getDb().select().from(projects).where(eq(projects.id, projectId)))[0];
    if (!project) throw new Error("project not found");
    const minRow = await getDb()
      .select({ n: sql<number>`coalesce(min(${jobs.issueNumber}), 0)` })
      .from(jobs)
      .where(and(eq(jobs.projectId, projectId), sql`${jobs.issueNumber} < 0`));
    const nextNum = Number(minRow[0]?.n ?? 0) - 1;
    const id = randomUUID();
    const branch = branchName(nextNum, title, id);
    const now = nowIso();
    await getDb().insert(jobs).values({
      id,
      projectId,
      issueNumber: nextNum < 0 ? nextNum : -1,
      issueTitle: title,
      issueBody: body,
      issueUrl: "",
      state: "intake",
      lastActiveState: "intake",
      boardColumn: "intake",
      branch,
      createdAt: now,
      updatedAt: now,
    });
    const dest = await addJobWorktree({
      rootPath: project.rootPath,
      projectId,
      jobId: id,
      branch,
      defaultBranch: project.defaultBranch,
    });
    await getDb().update(jobs).set({ worktreePath: dest, updatedAt: nowIso() }).where(eq(jobs.id, id));
    await logEvent({ projectId, jobId: id, event: "job.upsert", payload: { state: "intake" } });
    return id;
  }

  async sendToTriage(jobId: string, model?: string) {
    await assertAgentReady();
    const job = (await getDb().select().from(jobs).where(eq(jobs.id, jobId)))[0];
    if (!job) throw new Error("job not found");
    if (job.state !== "intake" && job.state !== "inbox") {
      throw new Error("only intake tickets can be sent to triage");
    }
    if (model?.trim()) setJobModel(jobId, model.trim());
    await getDb()
      .update(jobs)
      .set({
        state: "triage",
        lastActiveState: "intake",
        boardColumn: "triage",
        error: null,
        updatedAt: nowIso(),
      })
      .where(eq(jobs.id, jobId));
    const next = (await getDb().select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
    await logEvent({
      projectId: job.projectId,
      jobId,
      event: "lane.agent.start",
      payload: { lane: "triage", reason: "sent from intake", model: getJobModel(jobId) },
    });
    void this.invokeJob(next, "first");
    return { ok: true as const, model: getJobModel(jobId) };
  }

  async stopAgent(jobId: string) {
    this.stopping.add(jobId);
    const child = this.workers.get(jobId);
    child?.kill("SIGTERM");
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 4000);
        child.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    stopSession(jobId, "stopped by operator");
    const job = (await getDb().select().from(jobs).where(eq(jobs.id, jobId)))[0];
    const keepColumn = job?.boardColumn ?? "triage";
    const keepLane = job?.lastActiveState && job.lastActiveState !== "paused" ? job.lastActiveState : job?.state;
    await getDb()
      .update(jobs)
      .set({
        state: "paused",
        lastActiveState: keepLane && keepLane !== "paused" ? keepLane : "triage",
        boardColumn: keepColumn,
        lockedAt: null,
        lockedBy: null,
        error: null,
        updatedAt: nowIso(),
      })
      .where(eq(jobs.id, jobId));
    await logEvent({
      projectId: job?.projectId ?? "",
      jobId,
      event: "lane.agent.end",
      payload: { ok: true, stopped: true },
    });
    this.liveInvokes.delete(jobId);
  }

  async restartFromStep(jobId: string, step: RestartStepId) {
    await this.stopAgent(jobId);
    const def = RESTART_STEPS.find((s) => s.id === step);
    if (!def) throw new Error(`unknown step ${step}`);
    const clearByStep: Record<RestartStepId, ArtifactKind[]> = {
      intake: ["triage", "fr", "tech_spec", "task_graph", "review", "pr", "context"],
      triage: ["triage", "fr", "tech_spec", "task_graph", "review", "pr", "context"],
      planning: ["fr", "tech_spec", "task_graph", "review", "pr", "context"],
      tech_spec: ["tech_spec", "task_graph", "review", "pr", "context"],
      tasks: ["task_graph", "review", "pr", "context"],
      implementation: ["review", "pr", "context"],
      review: ["review", "pr", "context"],
    };
    const clear = clearByStep[step];
    if (clear.length) {
      await getDb()
        .delete(artifacts)
        .where(and(eq(artifacts.jobId, jobId), inArray(artifacts.kind, clear)));
    }
    trimSessionsFromStep(jobId, step);
    const jobRow = (await getDb().select().from(jobs).where(eq(jobs.id, jobId)))[0];
    if (jobRow?.worktreePath) {
      const docDir = path.join(
        jobRow.worktreePath,
        ".factory",
        "issues",
        String(Math.abs(jobRow.issueNumber)),
      );
      const laterDocs: Record<RestartStepId, string[]> = {
        intake: [
          "requirements.mdx",
          "requirements.md",
          "requirements.visualplan.json",
          "plan-spec.mdx",
          "tech-spec.mdx",
          "tech-spec.md",
          "tech-spec.visualplan.json",
          "tasks.json",
          "review.md",
          "review.json",
          "pull-request.md",
        ],
        triage: [
          "requirements.mdx",
          "requirements.md",
          "requirements.visualplan.json",
          "plan-spec.mdx",
          "tech-spec.mdx",
          "tech-spec.md",
          "tech-spec.visualplan.json",
          "tasks.json",
          "review.md",
          "review.json",
          "pull-request.md",
        ],
        planning: [
          "requirements.mdx",
          "requirements.md",
          "requirements.visualplan.json",
          "plan-spec.mdx",
          "tech-spec.mdx",
          "tech-spec.md",
          "tech-spec.visualplan.json",
          "tasks.json",
          "review.md",
          "review.json",
          "pull-request.md",
        ],
        tech_spec: [
          "tech-spec.mdx",
          "tech-spec.md",
          "tech-spec.visualplan.json",
          "tasks.json",
          "review.md",
          "review.json",
          "pull-request.md",
        ],
        tasks: ["tasks.json", "review.md", "review.json", "pull-request.md"],
        implementation: ["review.md", "review.json", "pull-request.md"],
        review: ["review.md", "review.json", "pull-request.md"],
      };
      for (const name of laterDocs[step]) {
        try {
          fs.unlinkSync(path.join(docDir, name));
        } catch {
          /* missing */
        }
      }
    }
    await getDb()
      .update(jobs)
      .set({
        state: def.state,
        lastActiveState: def.state,
        boardColumn: def.column,
        pendingArtifact: null,
        error: null,
        archivedAt: null,
        updatedAt: nowIso(),
      })
      .where(eq(jobs.id, jobId));
    this.stopping.delete(jobId);
    await this.checkpointer?.deleteThread(jobId);
    await restoreContextBeforeStep(jobId, step);
    const job = (await getDb().select().from(jobs).where(eq(jobs.id, jobId)))[0];
    if (!job) throw new Error("job not found");
    await logEvent({
      projectId: job.projectId,
      jobId,
      event: "job.upsert",
      payload: { state: def.state, restartFrom: step },
    });
    if (step === "intake") return { ok: true, parked: "intake" };
    return this.invokeJob(job, "continue");
  }

  async abortJob(jobId: string) {
    this.stopping.add(jobId);
    this.workers.get(jobId)?.kill("SIGTERM");
    stopSession(jobId, "cancelled");
    await getDb()
      .update(jobs)
      .set({ state: "rejected", rejectNote: "cancelled", lockedAt: null, lockedBy: null, updatedAt: nowIso() })
      .where(eq(jobs.id, jobId));
  }

  async deleteJob(jobId: string) {
    this.workers.get(jobId)?.kill("SIGTERM");
    this.liveInvokes.delete(jobId);
    this.abort.abort();
    this.abort = new AbortController();
    await gcWorktree(jobId);
    await getDb()
      .update(jobs)
      .set({
        archivedAt: nowIso(),
        lockedAt: null,
        lockedBy: null,
        updatedAt: nowIso(),
      })
      .where(eq(jobs.id, jobId));
  }

  async startPollers() {
    const rows = await getDb().select().from(projects);
    for (const p of rows) {
      this.schedulePoll(p.id);
    }
  }

  schedulePoll(projectId: string) {
    const existing = this.pollers.get(projectId);
    if (existing) clearTimeout(existing);
    const jitter = 25_000 + Math.floor(Math.random() * 10_000);
    const t = setTimeout(() => {
      void this.pollProject(projectId).finally(() => this.schedulePoll(projectId));
    }, jitter);
    this.pollers.set(projectId, t);
  }

  rateLimited(projectId: string): boolean {
    const until = this.backoffUntil.get(projectId);
    return Boolean(until && until > Date.now());
  }

  private async pollProject(projectId: string) {
    if (this.rateLimited(projectId)) return;
    try {
      await assertAgentReady();
    } catch {
      return;
    }
    const project = (await getDb().select().from(projects).where(eq(projects.id, projectId)))[0];
    if (!project) return;
    if (project.remoteKind !== "github" || !project.pollEnabled || !project.githubPatCiphertext) {
      return;
    }
    if (!project.repoOwner || !project.repoName) return;
    const pat = decryptPat(project.id, {
      ciphertext: project.githubPatCiphertext,
      iv: project.githubPatIv!,
      tag: project.githubPatTag!,
    });
    try {
      await ensureLabels(pat, project.repoOwner, project.repoName);
      let items = (await searchFactoryIssues(pat, project.repoOwner, project.repoName)).items;
      if (items.length === 0) {
        items = await listOpenFactoryIssues(pat, project.repoOwner, project.repoName);
      }
      let claimed = 0;
      for (const issue of items) {
        if (claimed >= 10) break;
        try {
          const id = randomUUID();
          const now = nowIso();
          const branch = branchName(issue.number, issue.title, id);
          await getDb().insert(jobs).values({
            id,
            projectId,
            issueNumber: issue.number,
            issueTitle: issue.title,
            issueBody: issue.body ?? "",
            issueUrl: issue.html_url,
            state: "intake",
            lastActiveState: "intake",
            boardColumn: "intake",
            branch,
            createdAt: now,
            updatedAt: now,
          });
          const label = await addClaimedLabel(pat, project.repoOwner, project.repoName, issue.number);
          if (label.status >= 400) {
            await logEvent({
              projectId,
              jobId: id,
              level: "error",
              event: "poller.label_failed",
              payload: { status: label.status },
            });
          }
          if (project.githubPatCiphertext) {
            const { env, cleanup } = gitEnvWithAskpass(pat);
            await runGit(["fetch", "--prune", "origin"], { cwd: project.rootPath, env }).catch(
              () => {},
            );
            cleanup();
          }
          const dest = await addJobWorktree({
            rootPath: project.rootPath,
            projectId,
            jobId: id,
            branch,
            defaultBranch: project.defaultBranch,
          });
          await getDb()
            .update(jobs)
            .set({ worktreePath: dest, updatedAt: nowIso() })
            .where(eq(jobs.id, id));
          claimed += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/UNIQUE/.test(msg)) {
            await logEvent({
              projectId,
              level: "error",
              event: "poller.error",
              payload: { error: msg },
            });
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/403|429/.test(msg)) {
        this.backoffUntil.set(projectId, Date.now() + 5 * 60 * 1000);
        await logEvent({
          projectId,
          level: "warn",
          event: "project.rate_limited",
          payload: { until: this.backoffUntil.get(projectId) },
        });
      }
    }
  }
}

async function restoreContextBeforeStep(jobId: string, step: RestartStepId) {
  const keep =
    step === "planning"
      ? await loadLatestArtifact(jobId, "triage")
      : step === "tech_spec"
        ? await loadLatestArtifact(jobId, "fr")
        : step === "tasks"
          ? await loadLatestArtifact(jobId, "tech_spec")
          : step === "implementation" || step === "review"
            ? await loadLatestArtifact(jobId, "task_graph")
            : null;
  if (!keep) return;
  if (keep.kind === "triage") {
    const parsed = TriageReportSchema.safeParse(keep.parsed);
    if (parsed.success) await writeLaneContext(jobId, contextFromTriage(parsed.data));
    return;
  }
  if (keep.kind === "fr") {
    const parsed = FunctionalRequirementsSchema.safeParse(keep.parsed);
    if (parsed.success) await writeLaneContext(jobId, contextFromFr(parsed.data));
    return;
  }
  if (keep.kind === "tech_spec") {
    const parsed = TechnicalSpecSchema.safeParse(keep.parsed);
    if (parsed.success) await writeLaneContext(jobId, contextFromSpec(parsed.data));
    return;
  }
  if (keep.kind === "task_graph") {
    const parsed = TaskGraphSchema.safeParse(keep.parsed);
    if (parsed.success) await writeLaneContext(jobId, contextFromTasks(parsed.data));
  }
}

async function seedFactoryState(
  job: typeof jobs.$inferSelect,
  dest: string,
): Promise<FactoryStateType> {
  const parse = async <T>(kind: ArtifactKind, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }) => {
    const row = await loadLatestArtifact(job.id, kind);
    if (!row) return null;
    const parsed = schema.safeParse(row.parsed);
    return parsed.success ? parsed.data : null;
  };
  const triage = await parse("triage", TriageReportSchema);
  return {
    jobId: job.id,
    projectId: job.projectId,
    issueNumber: job.issueNumber,
    stage: dest,
    triage,
    fr: await parse("fr", FunctionalRequirementsSchema),
    spec: await parse("tech_spec", TechnicalSpecSchema),
    tasks: await parse("task_graph", TaskGraphSchema),
    review: await parse("review", ReviewReportSchema),
    fastTrack: triage?.fastTrack ?? false,
    failedTaskId: null,
    prUrl: job.prUrl ?? null,
    error: null,
  };
}

let singleton: FactoryRuntime | null = null;

export function getRuntime(): FactoryRuntime {
  const g = globalThis as typeof globalThis & { __factoryRuntime?: FactoryRuntime };
  if (!g.__factoryRuntime) g.__factoryRuntime = new FactoryRuntime();
  singleton = g.__factoryRuntime;
  return singleton;
}

export async function retryImplementation(jobId: string) {
  const runtime = getRuntime();
  return runtime.withJobMutex(jobId, async () => {
    const job = (await getDb().select().from(jobs).where(eq(jobs.id, jobId)))[0];
    if (!job) throw new Error("not found");
    if (job.state !== "failed" || job.lastActiveState !== "implementation") {
      throw new Error("retry only from implementation failure");
    }
    const snap = await runtime.getState(jobId);
    if (!runtime.hasInterrupt(snap)) throw new Error("thread is not interrupted");
    const latest = await loadLatestArtifact(jobId, "task_graph");
    if (!latest) throw new Error("no task graph");
    const graph = TaskGraphSchema.parse(latest.parsed);
    const reset: TaskGraph = {
      version: 1,
      tasks: graph.tasks.map((t) =>
        t.status === "failed" ? { ...t, status: "pending" as const } : t,
      ),
    };
    await writeArtifact({ jobId, kind: "task_graph", source: "human", body: reset });
    await getDb()
      .update(jobs)
      .set({ implStartedAt: nowIso(), updatedAt: nowIso() })
      .where(eq(jobs.id, jobId));
    return runtime.resume(jobId, { action: "retry" }, { tasks: reset });
  });
}

export async function gcWorktree(jobId: string) {
  const job = (await getDb().select().from(jobs).where(eq(jobs.id, jobId)))[0];
  if (!job) return;
  const project = (await getDb().select().from(projects).where(eq(projects.id, job.projectId)))[0];
  if (!project) return;
  await removeJobWorktree(project.rootPath, job.worktreePath);
}

export { resetFlaggedTasks, desc };
