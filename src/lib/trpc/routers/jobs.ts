import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { agentEvents, artifacts, jobs } from "../../db/schema";
import {
  FunctionalRequirementsSchema,
  PullRequestDraftSchema,
  TaskGraphSchema,
  TechnicalSpecSchema,
} from "../../artifacts/schemas";
import { resetFlaggedTasks } from "../../artifacts/reset-flagged";
import { loadLatestArtifact, writeArtifact } from "../../artifacts/store";
import { nowIso } from "../../paths";
import { gcWorktree, getRuntime, retryImplementation } from "../../runtime";
import { badgeFor, columnForState, gateForState, nextStateForApprove } from "../../runtime/types";
import { loadPipelineForProject } from "../../runtime/pipeline";
import { TriageReportSchema } from "../../artifacts/schemas";
import { addJobWorktree, branchName } from "../../git/worktree";
import { projects } from "../../db/schema";
import { randomUUID } from "node:crypto";
import { requireAgent } from "../require-agent";
import { getSession, getSessionBundle } from "../../runtime/session-store";
import { getJobModel, setJobModel } from "../../runtime/llm";
import { displayLaneName, laneForJobState } from "../../runtime/ticket";
import { protectedProcedure, router } from "../init";

function cardOf(
  j: typeof jobs.$inferSelect,
  queued = false,
  triage?: { classification: string; risk: string; fastTrack: boolean },
  pipeline?: Parameters<typeof columnForState>[3],
) {
  return {
    id: j.id,
    projectId: j.projectId,
    issueNumber: j.issueNumber,
    title: j.issueTitle,
    state: j.state,
    column: columnForState(j.state, j.lastActiveState, j.boardColumn, pipeline),
    model: j.model ?? getJobModel(j.id),
    badge: badgeFor(j.state, queued),
    local: j.issueNumber < 0,
    issueUrl: j.issueUrl,
    lastActiveState: j.lastActiveState,
    tokensUsed: j.tokensUsed,
    needsApproval: j.state.startsWith("awaiting_"),
    branch: j.branch,
    prUrl: j.prUrl,
    error: j.error,
    triage,
  };
}

function parseArtifactForGate(gate: string, raw: unknown) {
  if (gate === "requirements") return FunctionalRequirementsSchema.parse(raw);
  if (gate === "tech_spec") return TechnicalSpecSchema.parse(raw);
  if (gate === "tasks") return TaskGraphSchema.parse(raw);
  if (gate === "pr") return PullRequestDraftSchema.parse(raw);
  throw new Error("no client artifact for review");
}

export const jobsRouter = router({
  create: protectedProcedure
    .input(z.object({ projectId: z.string(), title: z.string().min(1), body: z.string().default("") }))
    .mutation(async ({ input }) => {
      const id = await getRuntime().createLocalJob(input.projectId, input.title, input.body);
      return { id };
    }),
  sendToTriage: protectedProcedure
    .input(z.object({ id: z.string(), model: z.string().min(1).optional() }))
    .mutation(async ({ ctx, input }) => {
      await requireAgent();
      const job = (await ctx.db.select().from(jobs).where(eq(jobs.id, input.id)))[0];
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      return getRuntime().sendToTriage(input.id, input.model);
    }),
  list: protectedProcedure
    .input(z.object({ projectId: z.string(), states: z.array(z.string()).optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.projectId, input.projectId), isNull(jobs.archivedAt)));
      const pipeline = await loadPipelineForProject(input.projectId);
      const queued = getRuntime().queue.queued > 0;
      const triageByJob = new Map<string, { classification: string; risk: string; fastTrack: boolean }>();
      if (rows.length) {
        const triages = await ctx.db
          .select()
          .from(artifacts)
          .where(eq(artifacts.kind, "triage"));
        for (const row of triages) {
          const parsed = TriageReportSchema.safeParse(JSON.parse(row.body));
          if (!parsed.success) continue;
          const prev = triageByJob.get(row.jobId);
          if (!prev) triageByJob.set(row.jobId, parsed.data);
        }
      }
      const runtime = getRuntime();
      return rows
        .filter((j) => !input.states || input.states.includes(j.state))
        .map((j) => {
          const card = cardOf(
            j,
            queued && (j.state === "inbox" || j.state === "triage"),
            triageByJob.get(j.id),
            pipeline,
          );
          const live = getSessionBundle(j.id, { refresh: true }).current;
          const currentLane = laneForJobState(j.state, pipeline)?.key ?? j.state;
          const liveMatchesColumn = Boolean(live?.lane && laneForJobState(live.lane, pipeline)?.column === card.column);
          const awaiting = j.state.startsWith("awaiting_");
          const finished = j.state === "done" || card.column === "done";
          const running =
            !awaiting &&
            !finished &&
            (runtime.isJobRunning(j.id) || (live?.status === "running" && liveMatchesColumn));
          const agent =
            finished
              ? ("completed" as const)
              : awaiting
                ? ("idle" as const)
                : running
                  ? ("running" as const)
                  : j.state === "failed" || (liveMatchesColumn && live?.status === "error")
                    ? ("failed" as const)
                    : liveMatchesColumn && live?.status === "done"
                      ? ("completed" as const)
                      : ("idle" as const);
          return {
            ...card,
            agent,
            agentLane: displayLaneName(currentLane, pipeline),
          };
        });
    }),
  session: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const job = (await ctx.db.select().from(jobs).where(eq(jobs.id, input.id)))[0];
    if (!job) throw new TRPCError({ code: "NOT_FOUND" });
    const bundle = getSessionBundle(input.id);
    const live = bundle.current ?? getSession(input.id);
    const running =
      job.state !== "done" &&
      !job.state.startsWith("awaiting_") &&
      (getRuntime().isJobRunning(input.id) || live?.status === "running");
    const status = (
      job.state === "done"
        ? "done"
        : (live?.status ?? (job.error ? "error" : running ? "running" : "idle"))
    ) as "running" | "done" | "error" | "idle";
    const recentEvents = await ctx.db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.jobId, input.id))
      .orderBy(desc(agentEvents.createdAt))
      .limit(20);
    return {
      jobId: input.id,
      projectId: job.projectId,
      lane: displayLaneName(job.state, await loadPipelineForProject(job.projectId)),
      sessionLane: live?.lane ?? job.state,
      status,
      thinking: live?.thinking ?? "",
      text: live?.text ?? "",
      tools: live?.tools ?? [],
      error: live?.error ?? job.error ?? undefined,
      running,
      model: live?.model ?? getJobModel(input.id),
      updatedAt: live?.updatedAt,
      risk: live?.risk,
      classification: live?.classification,
      history: bundle.history,
      debug: {
        jobState: job.state,
        lastActiveState: job.lastActiveState,
        boardColumn: job.boardColumn,
        jobError: job.error,
        sessionError: live?.error,
        sessionId: live?.id,
        tools: live?.tools ?? [],
        events: recentEvents.reverse().map((e) => ({
          id: e.id,
          level: e.level,
          event: e.event,
          payload: e.payload,
          createdAt: e.createdAt,
        })),
      },
    };
  }),
  setModel: protectedProcedure
    .input(z.object({ id: z.string(), model: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const job = (await ctx.db.select().from(jobs).where(eq(jobs.id, input.id)))[0];
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      setJobModel(input.id, input.model);
      return { ok: true, model: getJobModel(input.id) };
    }),
  stop: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const job = (await ctx.db.select().from(jobs).where(eq(jobs.id, input.id)))[0];
    if (!job) throw new TRPCError({ code: "NOT_FOUND" });
    await getRuntime().stopAgent(input.id);
    return { ok: true };
  }),
  restartFrom: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        step: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAgent();
      const job = (await ctx.db.select().from(jobs).where(eq(jobs.id, input.id)))[0];
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      await getRuntime().restartFromStep(input.id, input.step);
      return { ok: true };
    }),
  retrySession: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await requireAgent();
    const job = (await ctx.db.select().from(jobs).where(eq(jobs.id, input.id)))[0];
    if (!job) throw new TRPCError({ code: "NOT_FOUND" });
    await getRuntime().retryLane(input.id);
    return { ok: true };
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
    const triageRow = (
      await ctx.db
        .select()
        .from(artifacts)
        .where(and(eq(artifacts.jobId, j.id), eq(artifacts.kind, "triage")))
        .orderBy(desc(artifacts.createdAt))
        .limit(1)
    )[0];
    const triageParsed = triageRow ? TriageReportSchema.safeParse(JSON.parse(triageRow.body)) : null;
    const pipeline = await loadPipelineForProject(j.projectId);
    return {
      ...cardOf(j, false, triageParsed?.success ? triageParsed.data : undefined, pipeline),
      issueBody: j.issueBody,
      pendingArtifact: j.pendingArtifact,
      worktreePath: j.worktreePath,
      interrupt,
    };
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
        draft: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const runtime = getRuntime();
      const job = (await ctx.db.select().from(jobs).where(eq(jobs.id, input.id)))[0];
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      const pipeline = await loadPipelineForProject(job.projectId);
      const gate = gateForState(job.state, pipeline);
      if (!gate) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "job is not awaiting approval" });
      }
      const gateAction = pipeline.lanes
        .flatMap((l) => l.actions)
        .find((a) => a.type === "human_approval" && a.gate === gate);
      if (input.action === "send_back" && !gateAction?.allowSendBack) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "send_back is not enabled at this gate" });
      }
      if ((input.action === "reject" || input.action === "send_back") && !input.note) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "note required" });
      }
      const nextState = nextStateForApprove(job.state, input.action, pipeline);
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
        if (gate === "pr") {
          const latest = await loadLatestArtifact(job.id, "pr");
          const parsed = parseArtifactForGate("pr", input.artifact ?? latest?.parsed);
          await writeArtifact({ jobId: job.id, kind: "pr", source: "human", body: parsed });
          await runtime.resume(job.id, {
            action: "approve",
            artifact: parsed,
            note: input.note,
            draft: input.draft,
          });
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
    if (job.state.startsWith("awaiting_") || job.state === "inbox" || job.state === "intake") return { ok: true };
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
  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const job = (await ctx.db.select().from(jobs).where(eq(jobs.id, input.id)))[0];
    if (!job) throw new TRPCError({ code: "NOT_FOUND" });
    if (job.archivedAt) return { ok: true };
    await getRuntime().deleteJob(job.id);
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
      state: "intake",
      lastActiveState: "intake",
      boardColumn: "intake",
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
