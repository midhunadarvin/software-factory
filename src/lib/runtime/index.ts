import { eq, and, isNull, sql, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { getDb } from "../db/client";
import { jobs, projects } from "../db/schema";
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
import { nowIso } from "../paths";
import { loadLatestArtifact, writeArtifact } from "../artifacts/store";
import { TaskGraphSchema, type TaskGraph } from "../artifacts/schemas";
import { resetFlaggedTasks } from "../artifacts/reset-flagged";
import { logEvent } from "./events";
import { compileFactoryGraph, openCheckpointer, type FactoryStateType } from "./graph";
import { acquirePidfile, readDeadPid, releasePidfile } from "./pidfile";
import { RunQueue } from "./queue";
import type { HitlResume } from "./types";

type CompiledGraph = ReturnType<typeof compileFactoryGraph>;

const mutexes = new Map<string, Promise<void>>();

export class FactoryRuntime {
  graph: CompiledGraph | null = null;
  checkpointer: ReturnType<typeof openCheckpointer> | null = null;
  queue = new RunQueue();
  started = false;
  abort = new AbortController();
  liveInvokes = new Set<string>();
  pollers = new Map<string, NodeJS.Timeout>();
  reaper: NodeJS.Timeout | null = null;
  backoffUntil = new Map<string, number>();

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
    if (!this.graph) throw new Error("runtime not started");
    const tuple = await this.checkpointer!.getTuple({ configurable: { thread_id: job.id } });
    const generation = job.invokeGeneration + 1;
    await getDb()
      .update(jobs)
      .set({
        invokeGeneration: generation,
        lockedBy: String(process.pid),
        lockedAt: nowIso(),
      })
      .where(eq(jobs.id, job.id));
    const config = {
      configurable: { thread_id: job.id, invokeGeneration: generation },
      signal: this.abort.signal,
    };
    const kindQueue = job.state === "implementation" || kind === "resume" && resume?.action === "retry"
      ? "impl"
      : "planning";
    const release = await this.queue.acquire(kindQueue);
    this.liveInvokes.add(job.id);
    try {
      if (kind === "resume") {
        return await this.graph.invoke(new Command({ resume, update }), config);
      }
      if (!tuple) {
        return await this.graph.invoke(
          {
            jobId: job.id,
            projectId: job.projectId,
            issueNumber: job.issueNumber,
            stage: "requirements_draft",
            fr: null,
            spec: null,
            tasks: null,
            review: null,
            failedTaskId: null,
            prUrl: null,
            error: null,
          },
          config,
        );
      }
      return await this.graph.invoke(null, config);
    } finally {
      this.liveInvokes.delete(job.id);
      release();
      await getDb()
        .update(jobs)
        .set({ lockedAt: null, lockedBy: null, updatedAt: nowIso() })
        .where(eq(jobs.id, job.id));
    }
  }

  async resume(jobId: string, resume: HitlResume, update?: Partial<FactoryStateType>) {
    const job = (await getDb().select().from(jobs).where(eq(jobs.id, jobId)))[0];
    if (!job) throw new Error("job not found");
    return this.invokeJob(job, "resume", resume, update);
  }

  async recoverJobs() {
    const rows = await getDb()
      .select()
      .from(jobs)
      .where(and(isNull(jobs.archivedAt)));
    for (const job of rows) {
      if (["paused", "rejected", "done"].includes(job.state)) continue;
      if (job.state === "failed" && job.lastActiveState !== "implementation") continue;
      if (this.liveInvokes.has(job.id)) continue;
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
        "inbox",
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
      state: "inbox",
      lastActiveState: "inbox",
      boardColumn: "requirements",
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
    const job = (await getDb().select().from(jobs).where(eq(jobs.id, id)))[0]!;
    void this.invokeJob(job, "first");
    await logEvent({ projectId, jobId: id, event: "job.upsert", payload: { state: "inbox" } });
    return id;
  }

  async abortJob(jobId: string) {
    this.abort.abort();
    this.abort = new AbortController();
    await getDb()
      .update(jobs)
      .set({ state: "rejected", rejectNote: "cancelled", lockedAt: null, lockedBy: null, updatedAt: nowIso() })
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
            state: "inbox",
            lastActiveState: "inbox",
            boardColumn: "requirements",
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
          const job = (await getDb().select().from(jobs).where(eq(jobs.id, id)))[0]!;
          void this.invokeJob(job, "first");
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
