import { z } from "zod";
import { loadLatestArtifact, writeArtifact } from "../artifacts/store";
import type {
  FunctionalRequirements,
  ReviewReport,
  TaskGraph,
  TechnicalSpec,
  TriageReport,
} from "../artifacts/schemas";

export const LaneContextSchema = z.object({
  version: z.literal(1),
  fromLane: z.string().min(1),
  summary: z.string().min(1).max(4000),
  bullets: z.array(z.string()).max(40).default([]),
});
export type LaneContext = z.infer<typeof LaneContextSchema>;

export function contextFromTriage(t: TriageReport): LaneContext {
  return {
    version: 1,
    fromLane: "triage",
    summary: `${t.classification} / ${t.risk} risk${t.fastTrack ? " · fast-track" : ""}`,
    bullets: [t.rationale, ...t.affectedAreas.map((a) => `area: ${a}`)].filter(Boolean),
  };
}

export function contextFromFr(fr: FunctionalRequirements): LaneContext {
  return {
    version: 1,
    fromLane: "requirements",
    summary: fr.summary,
    bullets: [
      ...fr.requirements.slice(0, 12).map((r) => `${r.id} [${r.priority}] ${r.statement}`),
      ...fr.outOfScope.slice(0, 6).map((x) => `out of scope: ${x}`),
    ],
  };
}

export function contextFromSpec(spec: TechnicalSpec): LaneContext {
  return {
    version: 1,
    fromLane: "tech_spec",
    summary: spec.summary,
    bullets: spec.modules.slice(0, 16).map((m) => `${m.path}: ${m.responsibility}`),
  };
}

export function contextFromTasks(g: TaskGraph): LaneContext {
  return {
    version: 1,
    fromLane: "tasks",
    summary: `${g.tasks.length} tasks in the graph`,
    bullets: g.tasks.slice(0, 24).map((t) => `${t.id} ${t.title} (${t.status})`),
  };
}

export function contextFromReview(r: ReviewReport): LaneContext {
  return {
    version: 1,
    fromLane: "review",
    summary: r.summary,
    bullets: [
      `verdict: ${r.verdict}`,
      ...r.findings.slice(0, 16).map((f) => `${f.severity} ${f.file}: ${f.title}`),
    ],
  };
}

export async function writeLaneContext(jobId: string, ctx: LaneContext) {
  await writeArtifact({ jobId, kind: "context", source: "agent", body: ctx });
}

export async function loadLaneContext(jobId: string): Promise<LaneContext | null> {
  const row = await loadLatestArtifact(jobId, "context");
  if (!row) return null;
  const parsed = LaneContextSchema.safeParse(row.parsed);
  return parsed.success ? parsed.data : null;
}

export function formatContextBlock(ctx: LaneContext | null): string {
  if (!ctx) return "No previous-lane context yet. This is the first lane.";
  return [
    `Previous lane: ${ctx.fromLane}`,
    ctx.summary,
    ...ctx.bullets.map((b) => `- ${b}`),
  ].join("\n");
}
