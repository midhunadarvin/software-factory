import { eq } from "drizzle-orm";
import type { ZodTypeAny } from "zod";
import { getDb } from "../db/client";
import { jobs } from "../db/schema";
import { loadLatestArtifact, writeArtifact } from "../artifacts/store";
import {
  FunctionalRequirementsSchema,
  PullRequestDraftSchema,
  ReviewReportSchema,
  TaskGraphSchema,
  TechnicalSpecSchema,
  type ArtifactKind,
} from "../artifacts/schemas";
import { nowIso } from "../paths";
import { wrapUntrusted } from "./untrusted";
import { loadLaneContext } from "./context";
import { runLaneHarness } from "./harness";
import { loadPipelineForProject, laneForJobState, type ResolvedPipeline } from "./pipeline";
import { getSession, appendChatTurn, chatTurns, type ChatTurn } from "./session-store";

export const STEER_TURN_CAP = 12;

export type SteerCode = "not_found" | "not_awaiting" | "no_target" | "running" | "no_model";

export class SteerError extends Error {
  code: SteerCode;
  constructor(code: SteerCode, message: string) {
    super(message);
    this.name = "SteerError";
    this.code = code;
  }
}

export type SteerTarget = {
  laneId: string;
  artifact: ArtifactKind;
  schema: ZodTypeAny;
};

const SCHEMA_BY_ARTIFACT: Partial<Record<ArtifactKind, ZodTypeAny>> = {
  fr: FunctionalRequirementsSchema,
  tech_spec: TechnicalSpecSchema,
  task_graph: TaskGraphSchema,
  review: ReviewReportSchema,
  pr: PullRequestDraftSchema,
};

export function steerTarget(state: string, pipeline: ResolvedPipeline): SteerTarget | null {
  if (!state.startsWith("awaiting_")) return null;
  const lane = laneForJobState(pipeline, state);
  if (!lane || lane.kind !== "agent") return null;
  const produce = lane.actions.find((a) => a.type === "produce" && a.artifact);
  const kind = produce?.artifact;
  if (!kind || kind === "triage") return null;
  const schema = SCHEMA_BY_ARTIFACT[kind];
  if (!schema) return null;
  return { laneId: lane.id, artifact: kind, schema };
}

export function formatSteerPrompt(opts: {
  laneId: string;
  artifact: unknown;
  turns: ChatTurn[];
  message: string;
}): string {
  const recent = opts.turns.slice(-STEER_TURN_CAP);
  const last = recent[recent.length - 1];
  const prior = last?.role === "user" ? recent.slice(0, -1) : recent;
  const convo = prior
    .map((t) => `${t.role === "user" ? "Operator" : "You"}: ${t.text}`)
    .join("\n\n");
  return [
    `Revise the current ${opts.laneId} document to match the operator's latest message.`,
    "Stay in this lane. Submit the revised document with the same tool as before, then stop.",
    "Do not finishLane, move the ticket, or approve. The operator will approve separately.",
    "The operator's message is intent. The current document is what you are editing.",
    "",
    "Current document:",
    JSON.stringify(opts.artifact, null, 2),
    convo ? `\nConversation:\n${convo}` : "",
    "",
    wrapUntrusted("operator", opts.message),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function agentTurnText(artifact: unknown, sessionText?: string): string {
  const fromSession = sessionText?.trim();
  if (fromSession) return fromSession.slice(0, 2000);
  if (artifact && typeof artifact === "object") {
    const rec = artifact as Record<string, unknown>;
    if (typeof rec.summary === "string" && rec.summary.trim()) {
      return `Updated the document. ${rec.summary.trim()}`.slice(0, 2000);
    }
    if (typeof rec.title === "string" && rec.title.trim()) {
      return `Updated the document. ${rec.title.trim()}`.slice(0, 2000);
    }
  }
  return "Updated the document.";
}

export async function persistParkedArtifact(
  jobId: string,
  kind: ArtifactKind,
  artifact: unknown,
): Promise<void> {
  const json = JSON.stringify(artifact);
  const latest = await loadLatestArtifact(jobId, kind);
  if (!latest || latest.body !== json) {
    await writeArtifact({ jobId, kind, source: "agent", body: artifact });
  }
  await getDb()
    .update(jobs)
    .set({ pendingArtifact: json, error: null, updatedAt: nowIso() })
    .where(eq(jobs.id, jobId));
}

type JobRow = typeof jobs.$inferSelect;

export function assertSteerJob(job: JobRow | undefined, isRunning: boolean): JobRow {
  if (!job) throw new SteerError("not_found", "job not found");
  if (job.archivedAt) throw new SteerError("not_found", "job is deleted");
  if (!job.state.startsWith("awaiting_")) {
    throw new SteerError("not_awaiting", "job is not awaiting approval");
  }
  if (isRunning) throw new SteerError("running", "agent is already running");
  return job;
}

export async function runSteer(
  job: JobRow,
  message: string,
): Promise<{ laneId: string; artifact: unknown }> {
  const text = message.trim();
  if (!text) throw new SteerError("no_target", "message is empty");
  const pipeline = await loadPipelineForProject(job.projectId);
  const target = steerTarget(job.state, pipeline);
  if (!target) {
    throw new SteerError("no_target", "this lane does not take chat while parked");
  }
  let current: unknown = null;
  const latest = await loadLatestArtifact(job.id, target.artifact);
  if (latest) current = latest.parsed;
  else if (job.pendingArtifact) {
    try {
      current = JSON.parse(job.pendingArtifact);
    } catch {
      current = null;
    }
  }
  if (current == null) throw new SteerError("no_target", "no parked artifact to revise");

  appendChatTurn(job.id, {
    role: "user",
    lane: target.laneId,
    text,
    at: nowIso(),
  });
  const turns = chatTurns(job.id).filter((t) => t.lane === target.laneId);

  const drafted = await runLaneHarness({
    lane: target.laneId,
    jobId: job.id,
    projectId: job.projectId,
    context: await loadLaneContext(job.id),
    schema: target.schema,
    userPrompt: formatSteerPrompt({
      laneId: target.laneId,
      artifact: current,
      turns,
      message: text,
    }),
    steer: true,
    artifact: target.artifact,
    currentArtifact: current,
  });
  const parsed = target.schema.parse(drafted.artifact);
  await persistParkedArtifact(job.id, target.artifact, parsed);
  appendChatTurn(job.id, {
    role: "agent",
    lane: target.laneId,
    text: agentTurnText(parsed, getSession(job.id)?.text),
    at: nowIso(),
  });

  const still = (await getDb().select().from(jobs).where(eq(jobs.id, job.id)).limit(1))[0];
  if (still && !still.state.startsWith("awaiting_")) {
    await getDb()
      .update(jobs)
      .set({
        state: job.state,
        boardColumn: job.boardColumn,
        lastActiveState: job.lastActiveState,
        updatedAt: nowIso(),
      })
      .where(eq(jobs.id, job.id));
  }
  return { laneId: target.laneId, artifact: parsed };
}
