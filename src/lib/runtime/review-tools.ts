import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tool } from "ai";
import { getDb } from "../db/client";
import { jobs } from "../db/schema";
import { nowIso } from "../paths";
import { writeArtifact } from "../artifacts/store";
import { frMarkdown, frMdx, specMarkdown, specMdx } from "../artifacts/templates";
import type { FunctionalRequirements, TechnicalSpec } from "../artifacts/schemas";
import { coerceFunctionalRequirements, coerceTechnicalSpec } from "../artifacts/coerce";
import { logEvent } from "./events";
import { setSessionArtifact, stopSession } from "./session-store";
import type { LaneId } from "./skills";

export async function requestHumanReview(opts: {
  jobId: string;
  lane: LaneId;
  artifact: unknown;
}): Promise<
  | { ok: true; waitingForHuman: true; column: string; document: string }
  | { ok: false; error: string }
> {
  const job = (await getDb().select().from(jobs).where(eq(jobs.id, opts.jobId)).limit(1))[0];
  if (!job) return { ok: false, error: "ticket not found" };

  if (opts.lane === "tech_spec") {
    const spec = coerceTechnicalSpec(opts.artifact);
    setSessionArtifact(opts.jobId, spec);
    await writeArtifact({ jobId: opts.jobId, kind: "tech_spec", source: "agent", body: spec });
    writeDoc(job, "tech-spec.mdx", specMdx(spec));
    writeDoc(job, "tech-spec.md", specMarkdown(spec));
    await park(opts.jobId, "awaiting_tech_spec_approval", "tech_spec", spec);
    await logEvent({
      projectId: job.projectId,
      jobId: opts.jobId,
      event: "job.approval_needed",
      payload: { gate: "tech_spec", document: "tech-spec.mdx" },
    });
    stopSession(opts.jobId);
    return { ok: true, waitingForHuman: true, column: "tech_spec", document: "tech-spec.mdx" };
  }

  const fr = coerceFunctionalRequirements(opts.artifact);
  setSessionArtifact(opts.jobId, fr);
  await writeArtifact({ jobId: opts.jobId, kind: "fr", source: "agent", body: fr });
  writeDoc(job, "requirements.mdx", frMdx(fr));
  writeDoc(job, "requirements.md", frMarkdown(fr));
  writeDoc(job, "plan-spec.mdx", frMdx(fr));
  await park(opts.jobId, "awaiting_requirements_approval", "planning", fr);
  await logEvent({
    projectId: job.projectId,
    jobId: opts.jobId,
    event: "job.approval_needed",
    payload: { gate: "requirements", document: "requirements.mdx" },
  });
  stopSession(opts.jobId);
  return { ok: true, waitingForHuman: true, column: "planning", document: "requirements.mdx" };
}

/** Fields the planning/tech-spec agent actually sends (top-level spec, not nested). */
export const reviewArtifactInputSchema = z
  .object({
    artifact: z.unknown().optional(),
    version: z.union([z.number(), z.string()]).optional(),
    summary: z.string().optional(),
    actors: z.array(z.string()).optional(),
    requirements: z.array(z.unknown()).optional(),
    outOfScope: z.array(z.unknown()).optional(),
    openQuestions: z.array(z.unknown()).optional(),
    visualPlan: z.unknown().optional(),
    stack: z.array(z.unknown()).optional(),
    modules: z.array(z.unknown()).optional(),
    dataChanges: z.array(z.unknown()).optional(),
    apiChanges: z.array(z.unknown()).optional(),
    risks: z.array(z.unknown()).optional(),
    testing: z.array(z.unknown()).optional(),
  })
  .passthrough();

/** Fields the review agent actually sends (top-level report, not nested). */
export const reviewReportInputSchema = z
  .object({
    artifact: z.unknown().optional(),
    version: z.union([z.number(), z.string()]).optional(),
    summary: z.string().optional(),
    verdict: z.string().optional(),
    findings: z.array(z.unknown()).optional(),
    filesChanged: z.array(z.string()).optional(),
    computedDiffs: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const pullRequestDraftInputSchema = z
  .object({
    artifact: z.unknown().optional(),
    version: z.union([z.number(), z.string()]).optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

/** Fields the tasks agent actually sends (top-level tasks[], not nested). */
export const taskGraphInputSchema = z
  .object({
    artifact: z.unknown().optional(),
    version: z.union([z.number(), z.string()]).optional(),
    tasks: z.array(z.unknown()).optional(),
    summary: z.string().optional(),
    title: z.string().optional(),
  })
  .passthrough();

export function pickReviewArtifact(input: unknown): unknown {
  if (typeof input === "string") return input;
  const o = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (!o) return input;
  if (o.artifact !== undefined && o.artifact !== null) return o;
  return o;
}

export function requestHumanReviewTool(jobId: string, lane: LaneId) {
  return {
    requestHumanReview: tool({
      description:
        "Write the planning or tech spec, park the ticket for Approve/Reject, and end this session. Pass the spec fields directly (summary, actors, requirements, visualPlan) — do not wrap them unless using artifact.",
      inputSchema: reviewArtifactInputSchema,
      execute: async (input) =>
        requestHumanReview({
          jobId,
          lane,
          artifact: pickReviewArtifact(input),
        }),
    }),
  };
}

async function park(
  jobId: string,
  state: "awaiting_requirements_approval" | "awaiting_tech_spec_approval",
  column: "planning" | "tech_spec",
  artifact: FunctionalRequirements | TechnicalSpec,
) {
  await getDb()
    .update(jobs)
    .set({
      state,
      boardColumn: column,
      lastActiveState: column === "planning" ? "requirements" : "tech_spec",
      pendingArtifact: JSON.stringify(artifact),
      error: null,
      lockedAt: null,
      lockedBy: null,
      updatedAt: nowIso(),
    })
    .where(eq(jobs.id, jobId));
}

function writeDoc(
  job: { issueNumber: number; worktreePath: string | null },
  filename: string,
  body: string,
) {
  if (!job.worktreePath) return;
  const dir = path.join(job.worktreePath, ".factory", "issues", String(Math.abs(job.issueNumber)));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), body);
}
