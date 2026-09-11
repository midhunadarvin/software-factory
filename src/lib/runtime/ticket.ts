import { eq } from "drizzle-orm";
import { z } from "zod";
import { tool } from "ai";
import { getDb } from "../db/client";
import { jobs } from "../db/schema";
import { nowIso } from "../paths";
import type { BoardColumn } from "./types";
import { getSession, patchSession, stopSession } from "./session-store";
import { LANES, laneForJobState, nextLane } from "./lanes";

export {
  LANES,
  RESTART_STEPS,
  displayLaneName,
  graphNodeForState,
  isRunnableLaneState,
  laneByKey,
  laneForJobState,
  nextLane,
} from "./lanes";
export type { LaneDef, LaneKey, RestartStepId } from "./lanes";

export async function loadTicket(jobId: string) {
  return (await getDb().select().from(jobs).where(eq(jobs.id, jobId)).limit(1))[0];
}

export async function getTicketView(jobId: string) {
  const job = await loadTicket(jobId);
  if (!job) return { ok: false as const, error: "ticket not found" };
  return {
    ok: true as const,
    id: job.id,
    title: job.issueTitle,
    body: job.issueBody,
    state: job.state,
    column: job.boardColumn,
    lastActiveState: job.lastActiveState,
    error: job.error,
    branch: job.branch,
  };
}

export async function setTicketStatus(
  jobId: string,
  status: "simple" | "complex" | "in_progress" | "blocked" | "done",
  note?: string,
) {
  const job = await loadTicket(jobId);
  if (!job) return { ok: false as const, error: "ticket not found" };
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  if (status === "blocked") patch.state = "paused";
  if (status === "done") {
    patch.state = "done";
    patch.boardColumn = "done";
  }
  if (status === "in_progress" && (job.state === "inbox" || job.state === "intake")) {
    patch.state = "triage";
    patch.boardColumn = "triage";
  }
  if (note) patch.rejectNote = note;
  await getDb().update(jobs).set(patch).where(eq(jobs.id, jobId));
  if (status === "simple" || status === "complex") {
    patchSession(jobId, { classification: status });
  }
  return { ok: true as const, status, state: (patch.state as string) ?? job.state, note };
}

export async function setTicketRisk(jobId: string, risk: "low" | "medium" | "high") {
  const job = await loadTicket(jobId);
  if (!job) return { ok: false as const, error: "ticket not found" };
  patchSession(jobId, { risk });
  return { ok: true as const, risk };
}

export async function moveTicketColumn(jobId: string, column: BoardColumn) {
  const job = await loadTicket(jobId);
  if (!job) return { ok: false as const, error: "ticket not found" };
  const lane = LANES.find((l) => l.column === column);
  await getDb()
    .update(jobs)
    .set({
      boardColumn: column,
      state: lane?.state ?? job.state,
      lastActiveState: job.state,
      updatedAt: nowIso(),
    })
    .where(eq(jobs.id, jobId));
  return { ok: true as const, column, state: lane?.state ?? job.state };
}

export async function advanceTicket(jobId: string) {
  const job = await loadTicket(jobId);
  if (!job) return { ok: false as const, error: "ticket not found" };
  const nxt = nextLane(job.state);
  if (!nxt) return { ok: false as const, error: `no next lane from ${job.state}` };
  await getDb()
    .update(jobs)
    .set({
      state: nxt.state,
      boardColumn: nxt.column,
      lastActiveState: laneForJobState(job.state)?.key ?? job.state,
      pendingArtifact: null,
      error: null,
      updatedAt: nowIso(),
    })
    .where(eq(jobs.id, jobId));
  return {
    ok: true as const,
    from: job.state,
    to: nxt.state,
    column: nxt.column,
    nextAgent: nxt.key,
  };
}

export async function finishLaneAndStop(jobId: string) {
  const session = getSession(jobId);
  const lane = session?.lane;
  if (lane && ["requirements", "tech_spec", "tasks"].includes(lane) && session.artifact == null) {
    return {
      ok: false as const,
      error: "Submit the lane artifact with submitArtifact first, then call finishLane.",
    };
  }
  if (lane === "review") {
    stopSession(jobId);
    return {
      ok: true as const,
      from: "review",
      to: "review",
      column: "pull_request" as const,
      nextAgent: null,
      session: "stopped" as const,
    };
  }
  if (lane === "implementation") {
    stopSession(jobId);
    return {
      ok: true as const,
      from: "implementation",
      to: "implementation",
      column: "implementation" as const,
      nextAgent: null,
      session: "stopped" as const,
      taskComplete: true,
    };
  }
  if (lane === "tasks") {
    const job = await loadTicket(jobId);
    if (job && (job.state === "implementation" || job.boardColumn === "implementation")) {
      stopSession(jobId);
      return {
        ok: true as const,
        from: "tasks",
        to: job.state,
        column: job.boardColumn,
        nextAgent: null,
        session: "stopped" as const,
      };
    }
  }
  if (lane === "requirements" || lane === "tech_spec") {
    const parked =
      lane === "requirements"
        ? { state: "awaiting_requirements_approval" as const, column: "planning" as const }
        : { state: "awaiting_tech_spec_approval" as const, column: "tech_spec" as const };
    await getDb()
      .update(jobs)
      .set({
        state: parked.state,
        boardColumn: parked.column,
        lastActiveState: lane,
        error: null,
        updatedAt: nowIso(),
      })
      .where(eq(jobs.id, jobId));
    stopSession(jobId);
    return {
      ok: true as const,
      from: lane,
      to: parked.state,
      column: parked.column,
      nextAgent: null,
      session: "stopped" as const,
      waitingForHuman: true,
    };
  }
  const advanced = await advanceTicket(jobId);
  if (!advanced.ok) return advanced;
  stopSession(jobId);
  return { ...advanced, session: "stopped" as const };
}

export function ticketTools(jobId: string) {
  return {
    getTicket: tool({
      description: "Read this ticket's title, status, and board column",
      inputSchema: z.object({}),
      execute: async () => getTicketView(jobId),
    }),
    setTicketStatus: tool({
      description: "Mark the ticket simple or complex (also in_progress, blocked, or done)",
      inputSchema: z.object({
        status: z.enum(["simple", "complex", "in_progress", "blocked", "done"]),
        note: z.string().max(500).optional(),
      }),
      execute: async ({ status, note }) => setTicketStatus(jobId, status, note),
    }),
    setRisk: tool({
      description: "Set ticket risk to low, medium, or high. Call this during triage before finishLane.",
      inputSchema: z.object({ risk: z.enum(["low", "medium", "high"]) }),
      execute: async ({ risk }) => setTicketRisk(jobId, risk),
    }),
    moveTicket: tool({
      description: "Move the ticket to a board column (triage, planning, tech_spec, tasks, implementation, pull_request, done)",
      inputSchema: z.object({
        column: z.enum(["triage", "planning", "tech_spec", "tasks", "implementation", "pull_request", "done"]),
      }),
      execute: async ({ column }) => moveTicketColumn(jobId, column),
    }),
    finishLane: tool({
      description:
        "Exit this session. Planning/tech spec: use requestHumanReview. Tasks and review: use submitArtifact. Implementation: call after gitCommit.",
      inputSchema: z.object({}),
      execute: async () => finishLaneAndStop(jobId),
    }),
  };
}
