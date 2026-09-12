import { z } from "zod";

export const ACTION_TYPES = [
  "produce",
  "implement",
  "fix",
  "human_approval",
  "publish",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ARTIFACT_KINDS = [
  "triage",
  "fr",
  "tech_spec",
  "task_graph",
  "review",
  "pr",
] as const;
export type PipelineArtifact = (typeof ARTIFACT_KINDS)[number];

export const SKIP_IF = ["fast_track", "review_approved"] as const;
export type SkipIf = (typeof SKIP_IF)[number];

export const ActionConfigSchema = z.object({
  type: z.enum(ACTION_TYPES),
  /** Typed artifact this action reads or writes. Required for `produce`. */
  artifact: z.enum(ARTIFACT_KINDS).optional(),
  /** Stable LangGraph node name. Defaults to `{laneId}_{type}` (or `{laneId}_draft` for produce). */
  graphNode: z.string().min(1).optional(),
  /** End the invoke after this action so the supervisor can start the next lane. */
  handoff: z.boolean().optional(),
  skipIf: z.enum(SKIP_IF).optional(),
  allowSendBack: z.boolean().optional(),
  /** Lane id to resume when the human sends the ticket back. */
  sendBackTo: z.string().optional(),
  /** Job state while parked at this gate. Defaults to `awaiting_{laneId}_approval`. */
  awaitingState: z.string().optional(),
  /** Gate id used by the approval API. Defaults to the lane id. */
  gate: z.string().optional(),
  prompt: z.string().optional(),
  skill: z.string().optional(),
});
export type ActionConfig = z.infer<typeof ActionConfigSchema>;

export const LaneConfigSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, "lane id must be snake_case"),
  label: z.string().min(1).max(80),
  /** Board column this lane occupies. Multiple lanes may share a column. */
  column: z.string().min(1),
  columnLabel: z.string().min(1).max(80).optional(),
  /** Restart-from id when it should differ from `id` (e.g. requirements → planning). */
  restartId: z.string().min(1).optional(),
  /** Hide this lane from the board column list (it still runs). */
  hidden: z.boolean().optional(),
  kind: z.enum(["intake", "agent", "terminal"]).optional(),
  queue: z.enum(["planning", "impl"]).optional(),
  actions: z.array(ActionConfigSchema).default([]),
});
export type LaneConfig = z.infer<typeof LaneConfigSchema>;

export const PipelineConfigSchema = z
  .object({
    version: z.literal(1),
    lanes: z.array(LaneConfigSchema).min(2),
  })
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    for (const [i, lane] of p.lanes.entries()) {
      if (ids.has(lane.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate lane id ${lane.id}`, path: ["lanes", i, "id"] });
      }
      ids.add(lane.id);
      for (const [j, action] of lane.actions.entries()) {
        if (action.type === "produce" && !action.artifact) {
          ctx.addIssue({
            code: "custom",
            message: "produce actions require artifact",
            path: ["lanes", i, "actions", j, "artifact"],
          });
        }
        if (action.sendBackTo && !ids.has(action.sendBackTo) && !p.lanes.some((l) => l.id === action.sendBackTo)) {
          ctx.addIssue({
            code: "custom",
            message: `sendBackTo ${action.sendBackTo} is not a lane`,
            path: ["lanes", i, "actions", j, "sendBackTo"],
          });
        }
      }
    }
    if (!p.lanes.some((l) => (l.kind ?? inferKind(l)) === "intake")) {
      ctx.addIssue({ code: "custom", message: "pipeline needs an intake lane" });
    }
    if (!p.lanes.some((l) => (l.kind ?? inferKind(l)) === "terminal")) {
      ctx.addIssue({ code: "custom", message: "pipeline needs a terminal (done) lane" });
    }
  });
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

export function inferKind(lane: Pick<LaneConfig, "id" | "kind" | "actions">): "intake" | "agent" | "terminal" {
  if (lane.kind) return lane.kind;
  if (lane.id === "intake" || lane.id === "inbox") return "intake";
  if (lane.id === "done") return "terminal";
  return lane.actions.length ? "agent" : "terminal";
}
