import { z } from "zod";

export const VisualPlanSchema = z
  .object({
    version: z.literal(1),
    title: z.string().min(1).max(200),
    outline: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          children: z.array(z.string()).default([]),
          notes: z.string().optional(),
        }),
      )
      .max(80),
    mermaid: z.string().min(1).max(20_000),
  })
  .superRefine((p, ctx) => {
    const ids = new Set(p.outline.map((n) => n.id));
    if (ids.size !== p.outline.length) {
      ctx.addIssue({ code: "custom", message: "duplicate outline id" });
    }
    for (const n of p.outline) {
      for (const c of n.children) {
        if (!ids.has(c)) {
          ctx.addIssue({ code: "custom", message: `missing outline id ${c}` });
        }
      }
    }
  });
export type VisualPlan = z.infer<typeof VisualPlanSchema>;

export const FunctionalRequirementsSchema = z.object({
  version: z.literal(1),
  summary: z.string().min(1).max(4000),
  actors: z.array(z.string()).min(1),
  requirements: z
    .array(
      z.object({
        id: z.string().regex(/^FR-\d+$/),
        statement: z.string().min(1),
        priority: z.enum(["must", "should", "could"]),
        acceptance: z.array(z.string()).min(1),
      }),
    )
    .min(1)
    .max(80),
  outOfScope: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  visualPlan: VisualPlanSchema,
});
export type FunctionalRequirements = z.infer<typeof FunctionalRequirementsSchema>;

export const TechnicalSpecSchema = z.object({
  version: z.literal(1),
  summary: z.string().min(1).max(4000),
  stack: z.array(z.object({ name: z.string(), reason: z.string() })),
  modules: z
    .array(
      z.object({
        name: z.string(),
        path: z.string(),
        responsibility: z.string(),
        interfaces: z.array(z.string()).default([]),
      }),
    )
    .min(1),
  dataChanges: z.array(z.string()).default([]),
  apiChanges: z.array(z.string()).default([]),
  risks: z.array(z.object({ risk: z.string(), mitigation: z.string() })).default([]),
  testing: z.array(z.string()).min(1),
  visualPlan: VisualPlanSchema,
});
export type TechnicalSpec = z.infer<typeof TechnicalSpecSchema>;

export const TaskNodeSchema = z.object({
  id: z.string().regex(/^T-\d+$/),
  title: z.string().min(1).max(200),
  dependsOn: z.array(z.string().regex(/^T-\d+$/)).default([]),
  files: z.array(z.string()).default([]),
  acceptance: z.array(z.string()).min(1),
  status: z.enum(["pending", "in_progress", "done", "failed"]).default("pending"),
});

export const TaskGraphSchema = z
  .object({
    version: z.literal(1),
    tasks: z.array(TaskNodeSchema).min(1).max(40),
  })
  .superRefine((g, ctx) => {
    const ids = new Set(g.tasks.map((t) => t.id));
    if (ids.size !== g.tasks.length) {
      ctx.addIssue({ code: "custom", message: "duplicate task id" });
    }
    for (const t of g.tasks) {
      for (const d of t.dependsOn) {
        if (!ids.has(d)) ctx.addIssue({ code: "custom", message: `missing dep ${d}` });
      }
    }
    const vis = new Map<string, 0 | 1 | 2>();
    const adj = new Map(g.tasks.map((t) => [t.id, t.dependsOn]));
    const dfs = (id: string): boolean => {
      const s = vis.get(id) ?? 0;
      if (s === 1) return true;
      if (s === 2) return false;
      vis.set(id, 1);
      for (const d of adj.get(id) ?? []) if (dfs(d)) return true;
      vis.set(id, 2);
      return false;
    };
    for (const t of g.tasks) {
      if (dfs(t.id)) ctx.addIssue({ code: "custom", message: "cycle in TaskGraph" });
    }
  });
export type TaskGraph = z.infer<typeof TaskGraphSchema>;
export type TaskNode = z.infer<typeof TaskNodeSchema>;

export const ReviewFindingSchema = z.object({
  id: z.string(),
  file: z.string(),
  startLine: z.number().int().optional(),
  endLine: z.number().int().optional(),
  severity: z.enum(["blocker", "major", "minor", "info"]),
  title: z.string(),
  body: z.string(),
  diff: z.string().optional(),
});

export const ReviewReportSchema = z.object({
  version: z.literal(1),
  summary: z.string().min(1).max(4000),
  verdict: z.enum(["approve", "request_changes"]),
  findings: z.array(ReviewFindingSchema).max(200),
  filesChanged: z.array(z.string()).max(400),
  computedDiffs: z
    .array(z.object({ file: z.string(), diff: z.string().max(50_000) }))
    .default([]),
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

export const TriageReportSchema = z.object({
  version: z.literal(1),
  classification: z.enum(["simple", "complex"]),
  risk: z.enum(["low", "medium", "high"]),
  rationale: z.string().min(1).max(4000),
  affectedAreas: z.array(z.string()).max(20).default([]),
  fastTrack: z.boolean(),
});
export type TriageReport = z.infer<typeof TriageReportSchema>;

export function triageFastTrack(t: Pick<TriageReport, "classification" | "risk">): boolean {
  return t.classification === "simple" && t.risk === "low";
}

export const PullRequestDraftSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
});
export type PullRequestDraft = z.infer<typeof PullRequestDraftSchema>;

export type ArtifactKind = "triage" | "fr" | "tech_spec" | "task_graph" | "review" | "context" | "pr";
