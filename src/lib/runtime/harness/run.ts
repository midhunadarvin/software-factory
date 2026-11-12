import { eq } from "drizzle-orm";
import type { ZodTypeAny } from "zod";
import { getDb } from "../../db/client";
import { jobs, projects } from "../../db/schema";
import { getAgent } from "@software-factory/agent-sdk";
import type { ArtifactKind } from "../../artifacts/schemas";
import type { LaneContext } from "../context";
import type { LaneId } from "../skills";
import { getStoredJobModel, setJobModel } from "../llm";
import { finishSession, startSession } from "../session-store";
import { loadTicket } from "../ticket";
import { modelFlagForHarness } from "./model-flag";
import { resolveLaneModel } from "./resolve-model";
import { coerceHarnessArtifact, inferTriageFromText, parseArtifactFromText, readArtifactFile } from "./artifact-file";
import { buildLaneBrief } from "./brief";
import { harnessForLane, harnessFromProject } from "./config";
import { detectCliHarnesses } from "./detect";
import { clearLiveHarness, lastHarnessSession, liveHarness, rememberHarnessSession, setLiveHarness } from "./live";
import { requireHarness } from "./registry";
import type { HarnessId } from "./types";

export async function resolveJobHarness(projectId: string, laneId: string): Promise<HarnessId> {
  await detectCliHarnesses();
  const project = (await getDb().select().from(projects).where(eq(projects.id, projectId)).limit(1))[0];
  return harnessForLane(harnessFromProject(project), laneId);
}

export async function runLaneHarness<S extends ZodTypeAny>(opts: {
  lane: LaneId;
  jobId: string;
  projectId: string;
  context: LaneContext | null;
  userPrompt: string;
  skill?: string;
  schema: S;
  steer?: boolean;
  artifact?: ArtifactKind;
  currentArtifact?: unknown;
  write?: boolean;
}): Promise<{ artifact: ReturnType<S["parse"]>; text: string }> {
  const job = await loadTicket(opts.jobId);
  if (!job) throw new Error("job not found");
  const harnessId = await resolveJobHarness(opts.projectId, opts.lane);
  const plugin = requireHarness(harnessId);
  if (harnessId !== "inprocess") {
    const detected = await plugin.detect();
    if (!detected.ok) throw new Error(detected.error);
    if (!job.worktreePath) throw new Error("CLI harness needs a job worktree");
  }

  const artifact = opts.artifact ?? getAgent(opts.lane)?.artifact;
  const brief = buildLaneBrief({
    laneId: opts.lane,
    ticketTitle: job.issueTitle,
    ticketBody: job.issueBody,
    context: opts.context,
    userPrompt: opts.userPrompt,
    skill: opts.skill,
    artifact,
    currentArtifact: opts.currentArtifact,
    write: opts.write,
    issueNumber: job.issueNumber,
    cli: harnessId !== "inprocess",
  });

  const live = opts.steer ? liveHarness(opts.jobId) : undefined;
  if (live && harnessId !== "inprocess") {
    await live.send(opts.userPrompt);
    const out = await live.result;
    rememberHarnessSession(opts.jobId, out.sessionId);
    clearLiveHarness(opts.jobId);
    const parsed = takeArtifact(opts.schema, artifact, job.worktreePath, job.issueNumber, out.artifact, out.text);
    return { artifact: parsed, text: out.text };
  }

  const stored = getStoredJobModel(opts.jobId);
  const resolved = await resolveLaneModel(harnessId, stored);
  if (resolved && resolved !== stored) setJobModel(opts.jobId, resolved);
  const model = modelFlagForHarness(harnessId, resolved);
  if (harnessId !== "inprocess") {
    startSession(opts.jobId, opts.projectId, opts.lane, model ?? resolved);
  }

  const session = await plugin.start({
    jobId: opts.jobId,
    projectId: opts.projectId,
    laneId: opts.lane,
    cwd: job.worktreePath,
    brief,
    userPrompt: opts.userPrompt,
    skill: opts.skill,
    context: opts.context,
    steer: opts.steer,
    resumeSessionId: opts.steer ? lastHarnessSession(opts.jobId) : undefined,
    artifact,
    schema: opts.schema,
    write: opts.write,
    model,
  });
  setLiveHarness(opts.jobId, session);
  try {
    const out = await session.result;
    rememberHarnessSession(opts.jobId, out.sessionId ?? session.id);
    if (out.code !== 0 && harnessId !== "inprocess") {
      throw new Error(`harness ${harnessId} exited ${out.code}${out.text ? `: ${out.text.slice(0, 400)}` : ""}`);
    }
    if (opts.write) {
      if (harnessId !== "inprocess") finishSession(opts.jobId, "done");
      return { artifact: (out.artifact ?? null) as ReturnType<S["parse"]>, text: out.text };
    }
    const parsed = takeArtifact(opts.schema, artifact, job.worktreePath, job.issueNumber, out.artifact, out.text);
    if (harnessId !== "inprocess") finishSession(opts.jobId, "done");
    return { artifact: parsed, text: out.text };
  } catch (err) {
    if (harnessId !== "inprocess") {
      finishSession(opts.jobId, "error", err instanceof Error ? err.message : String(err));
    }
    throw err;
  } finally {
    clearLiveHarness(opts.jobId);
  }
}

function takeArtifact<S extends ZodTypeAny>(
  schema: S,
  kind: ArtifactKind | undefined,
  worktree: string | null,
  issueNumber: number,
  fromSession: unknown,
  fromText?: string,
): ReturnType<S["parse"]> {
  let raw = fromSession;
  if (raw == null && kind && worktree) {
    raw = readArtifactFile(worktree, issueNumber, kind);
  }
  if (raw == null && fromText) {
    raw = parseArtifactFromText(fromText);
  }
  if (raw == null && fromText && kind === "triage") {
    raw = inferTriageFromText(fromText);
  }
  if (raw == null) {
    const hint = fromText?.trim() ? `: ${fromText.trim().slice(0, 400)}` : "";
    throw new Error(
      kind
        ? `harness finished without ${kind} JSON at .factory/issues/${Math.abs(issueNumber)}/${kind}.json${hint}`
        : `harness finished without an artifact${hint}`,
    );
  }
  const coerced = kind ? coerceHarnessArtifact(kind, raw) : raw;
  return schema.parse(coerced);
}

export async function stopJobHarness(jobId: string) {
  const session = liveHarness(jobId);
  if (!session) return;
  await session.stop();
  clearLiveHarness(jobId);
}
