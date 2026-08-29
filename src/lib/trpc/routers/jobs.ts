import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { agentEvents, artifacts, jobs } from "../../db/schema";
import {
  FunctionalRequirementsSchema,
  TaskGraphSchema,
  TechnicalSpecSchema,
} from "../../artifacts/schemas";
import { resetFlaggedTasks } from "../../artifacts/reset-flagged";
import { loadLatestArtifact, writeArtifact } from "../../artifacts/store";
import { nowIso } from "../../paths";
import { gcWorktree, getRuntime, retryImplementation } from "../../runtime";
import { badgeFor, gateForState, nextStateForApprove } from "../../runtime/types";
import { addJobWorktree, branchName } from "../../git/worktree";
import { projects } from "../../db/schema";
import { randomUUID } from "node:crypto";
import { protectedProcedure, router } from "../init";

function cardOf(j: typeof jobs.$inferSelect, queued = false) {
  return {
    id: j.id,
    projectId: j.projectId,
    issueNumber: j.issueNumber,
    title: j.issueTitle,
    state: j.state,
    column: j.boardColumn,
    badge: badgeFor(j.state, queued),
    local: j.issueNumber < 0,
    issueUrl: j.issueUrl,
    lastActiveState: j.lastActiveState,
    tokensUsed: j.tokensUsed,
    needsApproval: j.state.startsWith("awaiting_"),
    branch: j.branch,
    prUrl: j.prUrl,
    error: j.error,
  };
}

function parseArtifactForGate(gate: string, raw: unknown) {
  if (gate === "requirements") return FunctionalRequirementsSchema.parse(raw);
  if (gate === "tech_spec") return TechnicalSpecSchema.parse(raw);
  if (gate === "tasks") return TaskGraphSchema.parse(raw);
  throw new Error("no client artifact for review");
}

export const jobsRouter = router({
  create: protectedProcedure
    .input(z.object({ projectId: z.string(), title: z.string().min(1), body: z.string().default("") }))
    .mutation(async ({ input }) => {
      const id = await getRuntime().createLocalJob(input.projectId, input.title, input.body);
      return { id };
    }),
  list: protectedProcedure
    .input(z.object({ projectId: z.string(), states: z.array(z.string()).optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.projectId, input.projectId), isNull(jobs.archivedAt)));
      const queued = getRuntime().queue.queued > 0;
      return rows
        .filter((j) => !input.states || input.states.includes(j.state))
        .map((j) => cardOf(j, queued && j.state === "inbox"));
    }),
  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const j = (await ctx.db.select().from(jobs).where(eq(jobs.id, input.id)))[0];
    if (!j) throw new TRPCError({ code: "NOT_FOUND" });
    let interrupt: unknown = null;
    try {
      const snap = await getRuntime().getState(j.id);
      interrupt = (snap as { interrupts?: unknown }).interrupts ?? null;
    } catch {
      interrupt = null;
    }
    return { ...cardOf(j), issueBody: j.issueBody, pendingArtifact: j.pendingArtifact, interrupt };
  }),
  artifacts: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    return ctx.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.jobId, input.id))
      .orderBy(desc(artifacts.createdAt));
  }),
  events: protectedProcedure
    .input(z.object({ id: z.string(), after: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(agentEvents)
        .where(eq(agentEvents.jobId, input.id))
        .orderBy(desc(agentEvents.createdAt))
        .limit(200);
      if (!input.after) return rows.reverse();
      return rows.filter((r) => r.createdAt > input.after!).reverse();
    }),
  approve: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        action: z.enum(["approve", "reject", "send_back"]),
        artifact: z.unknown().optional(),
        note: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const runtime = getRuntime();
      const job = (await ctx.db.select().from(jobs).where(eq(jobs.id, input.id)))[0];
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      const gate = gateForState(job.state);
      if (!gate) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "job is not awaiting approval" });
      }
      if (input.action === "send_back" && gate !== "review") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "send_back only at review gate" });
      }
      if ((input.action === "reject" || input.action === "send_back") && !input.note) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "note required" });
      }
      const nextState = nextStateForApprove(job.state, input.action);
      await runtime.withJobMutex(job.id, async () => {
        const cas = await ctx.db
          .update(jobs)
          .set({ state: nextState, updatedAt: nowIso() })
          .where(and(eq(jobs.id, input.id), eq(jobs.state, job.state)));
        if (cas.changes === 0) {
          throw new TRPCError({ code: "CONFLICT", message: "state changed" });
        }
        const snap = await runtime.getState(job.id);
        if (!runtime.hasInterrupt(snap)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "thread is not interrupted; wait for boot 2x2 to re-park",
          });
        }
        if (input.action === "reject") {
          await runtime.resume(job.id, { action: "reject", note: input.note! });
          return;
        }
        if (input.action === "send_back") {
          const latestTasks = await loadLatestArtifact(job.id, "task_graph");
          const latestReview = await loadLatestArtifact(job.id, "review");
          let update: { tasks?: ReturnType<typeof resetFlaggedTasks> } = {};
          if (latestTasks && latestReview) {
            update = {
              tasks: resetFlaggedTasks(
                TaskGraphSchema.parse(latestTasks.parsed),
                latestReview.parsed as never,
              ),
            };
          }
          await runtime.resume(job.id, { action: "send_back", note: input.note! }, update);
          return;
        }
        if (gate === "review") {
          await runtime.resume(job.id, { action: "approve", note: input.note });
          return;
        }
        const latestKind =
          gate === "requirements" ? "fr" : gate === "tech_spec" ? "tech_spec" : "task_graph";
        const latest = await loadLatestArtifact(job.id, latestKind);
        const parsed = parseArtifactForGate(gate, input.artifact ?? latest?.parsed);
        await writeArtifact({ jobId: job.id, kind: latestKind, source: "human", body: parsed });
        await runtime.resume(job.id, { action: "approve", artifact: parsed, note: input.note });
      });
      return { ok: true };
    }),
  pause: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const job = (await ctx.db.select().from(jobs).where(eq(jobs.id, input.id)))[0];
    if (!job) throw new TRPCError({ code: "NOT_FOUND" });
    if (job.state.startsWith("awaiting_") || job.state === "inbox") return { ok: true };
    await ctx.db
      .update(jobs)
      .set({ state: "paused", updatedAt: nowIso(), lockedAt: null, lockedBy: null })
      .where(eq(jobs.id, job.id));
    return { ok: true };
  }),
  resume: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const job = (await ctx.db.select().from(jobs).where(eq(jobs.id, input.id)))[0];
    if (!job) throw new TRPCError({ code: "NOT_FOUND" });
    void getRuntime().invokeJob(job, "continue");
    return { ok: true };
  }),
  cancel: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const job = (await ctx.db.select().from(jobs).where(eq(jobs.id, input.id)))[0];
    if (!job) throw new TRPCError({ code: "NOT_FOUND" });
    if (job.state === "done") throw new TRPCError({ code: "PRECONDITION_FAILED" });
    await getRuntime().abortJob(job.id);
    return { ok: true };
  }),
  archive: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.update(jobs).set({ archivedAt: nowIso() }).where(eq(jobs.id, input.id));
    return { ok: true };
  }),
  reopen: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const job = (await ctx.db.select().from(jobs).where(eq(jobs.id, input.id)))[0];
    if (!job) throw new TRPCError({ code: "NOT_FOUND" });
    if (!["rejected", "failed"].includes(job.state)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED" });
    }
    await gcWorktree(job.id);
    await ctx.db.update(jobs).set({ archivedAt: nowIso() }).where(eq(jobs.id, job.id));
    const project = (await ctx.db.select().from(projects).where(eq(projects.id, job.projectId)))[0]!;
    const id = randomUUID();
    const branch = branchName(job.issueNumber, job.issueTitle, id);
    const now = nowIso();
    await ctx.db.insert(jobs).values({
      id,
      projectId: job.projectId,
      issueNumber: job.issueNumber,
      issueTitle: job.issueTitle,
      issueBody: job.issueBody,
      issueUrl: job.issueUrl,
      state: "inbox",
      lastActiveState: "inbox",
      boardColumn: "requirements",
      branch,
      createdAt: now,
      updatedAt: now,
    });
    const dest = await addJobWorktree({
      rootPath: project.rootPath,
      projectId: project.id,
      jobId: id,
      branch,
      defaultBranch: project.defaultBranch,
    });
    await ctx.db.update(jobs).set({ worktreePath: dest }).where(eq(jobs.id, id));
    const created = (await ctx.db.select().from(jobs).where(eq(jobs.id, id)))[0]!;
    void getRuntime().invokeJob(created, "first");
    return { id };
  }),
  retryImplementation: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await retryImplementation(input.id);
      return { ok: true };
    }),
  gcWorktree: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    await gcWorktree(input.id);
    return { ok: true };
  }),
});
