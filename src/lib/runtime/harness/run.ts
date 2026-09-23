import { eq } from "drizzle-orm";
import type { ZodTypeAny } from "zod";
import { getDb } from "../../db/client";
import { jobs, projects } from "../../db/schema";
import { getAgent } from "@software-factory/agent-sdk";
import type { ArtifactKind } from "../../artifacts/schemas";
import type { LaneContext } from "../context";
import type { LaneId } from "../skills";
import { loadTicket } from "../ticket";
import { coerceHarnessArtifact, readArtifactFile } from "./artifact-file";
import { buildLaneBrief } from "./brief";
import { harnessForLane, harnessFromProject } from "./config";
import { clearLiveHarness, lastHarnessSession, liveHarness, rememberHarnessSession, setLiveHarness } from "./live";
import { requireHarness } from "./registry";
import type { HarnessId } from "./types";

export async function resolveJobHarness(projectId: string, laneId: string): Promise<HarnessId> {
  const project = (await getDb().select().from(projects).where(eq(projects.id, projectId)).limit(1))[0];
  return harnessForLane(harnessFromProject(project), laneId);
}

export async function runLaneHarness<S extends ZodTypeAny>(opts: {
  lane: LaneId;
  jobId: string;
  projectId: string;
  context: LaneContext | null;
  userPrompt: string;
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
    artifact,
    currentArtifact: opts.currentArtifact,
    write: opts.write,
  });

  const live = opts.steer ? liveHarness(opts.jobId) : undefined;
  if (live && harnessId !== "inprocess") {
    await live.send(opts.userPrompt);
    const out = await live.result;
    rememberHarnessSession(opts.jobId, out.sessionId);
    clearLiveHarness(opts.jobId);
    const parsed = takeArtifact(opts.schema, artifact, job.worktreePath, job.issueNumber, out.artifact);
    return { artifact: parsed, text: out.text };
  }

  const session = await plugin.start({
    jobId: opts.jobId,
    projectId: opts.projectId,
    laneId: opts.lane,
    cwd: job.worktreePath,
    brief,
    userPrompt: opts.userPrompt,
    context: opts.context,
    steer: opts.steer,
    resumeSessionId: opts.steer ? lastHarnessSession(opts.jobId) : undefined,
    artifact,
    schema: opts.schema,
    write: opts.write,
  });
  setLiveHarness(opts.jobId, session);
  try {
    const out = await session.result;
    rememberHarnessSession(opts.jobId, out.sessionId ?? session.id);
    if (out.code !== 0 && harnessId !== "inprocess") {
      throw new Error(`harness ${harnessId} exited ${out.code}${out.text ? `: ${out.text.slice(0, 400)}` : ""}`);
    }
    if (opts.write) {
      return { artifact: (out.artifact ?? null) as ReturnType<S["parse"]>, text: out.text };
    }
    const parsed = takeArtifact(opts.schema, artifact, job.worktreePath, job.issueNumber, out.artifact);
    return { artifact: parsed, text: out.text };
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
): ReturnType<S["parse"]> {
  let raw = fromSession;
  if (raw == null && kind && worktree) {
    raw = readArtifactFile(worktree, issueNumber, kind);
  }
  if (raw == null) {
    throw new Error(
      kind
        ? `harness finished without ${kind} JSON at .factory/issues/${Math.abs(issueNumber)}/${kind}.json`
        : "harness finished without an artifact",
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
