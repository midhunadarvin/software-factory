import type { ArtifactKind } from "../../artifacts/schemas";
import { DEFAULT_PIPELINE } from "./default";
import {
  inferKind,
  PipelineConfigSchema,
  type ActionConfig,
  type ActionType,
  type PipelineArtifact,
  type PipelineConfig,
  type SkipIf,
} from "./schema";

export type ResolvedAction = {
  type: ActionType;
  laneId: string;
  graphNode: string;
  artifact?: PipelineArtifact;
  handoff: boolean;
  skipIf?: SkipIf;
  allowSendBack: boolean;
  sendBackTo?: string;
  awaitingState?: string;
  gate?: string;
  prompt?: string;
  skill?: string;
};

export type ResolvedLane = {
  id: string;
  label: string;
  column: string;
  columnLabel: string;
  displayName: string;
  restartId: string;
  hidden: boolean;
  kind: "intake" | "agent" | "terminal";
  queue: "planning" | "impl";
  state: string;
  next: string | null;
  graphNode: string;
  actions: ResolvedAction[];
};

export type BoardColumnDef = {
  id: string;
  label: string;
  n: string;
};

export type RestartStep = {
  id: string;
  label: string;
  state: string;
  column: string;
};

export type ResolvedPipeline = {
  config: PipelineConfig;
  lanes: ResolvedLane[];
  columns: BoardColumnDef[];
  restartSteps: RestartStep[];
  graphNodes: string[];
  firstAgentNode: string;
  laneById: Map<string, ResolvedLane>;
  actionByNode: Map<string, ResolvedAction>;
};

export function parsePipeline(raw: unknown): PipelineConfig {
  if (raw == null || raw === "") return DEFAULT_PIPELINE;
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  return PipelineConfigSchema.parse(value);
}

export function tryParsePipeline(raw: unknown): { ok: true; pipeline: PipelineConfig } | { ok: false; error: string } {
  try {
    return { ok: true, pipeline: parsePipeline(raw) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export function defaultGraphNode(laneId: string, action: ActionConfig, index: number): string {
  if (action.graphNode) return action.graphNode;
  if (action.type === "produce") return `${laneId}_draft`;
  if (action.type === "human_approval") return `${laneId}_gate`;
  if (action.type === "implement") return laneId;
  if (action.type === "publish") return `${laneId}_publish`;
  if (action.type === "fix") return `${laneId}_fix`;
  return `${laneId}_${action.type}_${index}`;
}

export function resolvePipeline(config: PipelineConfig = DEFAULT_PIPELINE): ResolvedPipeline {
  const parsed = PipelineConfigSchema.parse(config);
  const lanes: ResolvedLane[] = parsed.lanes.map((lane, i) => {
    const kind = inferKind(lane);
    const next = parsed.lanes[i + 1]?.id ?? null;
    const actions: ResolvedAction[] = lane.actions.map((action, j) => ({
      type: action.type,
      laneId: lane.id,
      graphNode: defaultGraphNode(lane.id, action, j),
      artifact: action.artifact,
      handoff: Boolean(action.handoff),
      skipIf: action.skipIf,
      allowSendBack: Boolean(action.allowSendBack),
      sendBackTo: action.sendBackTo,
      awaitingState:
        action.type === "human_approval"
          ? (action.awaitingState ?? `awaiting_${lane.id}_approval`)
          : action.awaitingState,
      gate: action.type === "human_approval" ? (action.gate ?? lane.id) : action.gate,
      prompt: action.prompt,
      skill: action.skill,
    }));
    const first = actions[0];
    return {
      id: lane.id,
      label: lane.label,
      column: lane.column,
      columnLabel: lane.columnLabel ?? lane.label,
      displayName: displayNameFor(lane.id, lane.label, lane.columnLabel),
      restartId: lane.restartId ?? lane.id,
      hidden: Boolean(lane.hidden),
      kind,
      queue: lane.queue ?? (lane.id === "implementation" ? "impl" : "planning"),
      state: lane.id === "intake" ? "intake" : lane.id,
      next,
      graphNode: first?.graphNode ?? lane.id,
      actions,
    };
  });

  const columns: BoardColumnDef[] = [];
  const seen = new Set<string>();
  for (const lane of lanes) {
    if (lane.hidden || seen.has(lane.column)) continue;
    seen.add(lane.column);
    columns.push({
      id: lane.column,
      label: lane.columnLabel,
      n: String(columns.length).padStart(2, "0"),
    });
  }

  const restartSteps: RestartStep[] = lanes
    .filter((l) => l.kind !== "terminal")
    .map((l) => ({
      id: l.restartId,
      label: l.label,
      state: l.state,
      column: l.column,
    }));

  const actionByNode = new Map<string, ResolvedAction>();
  for (const lane of lanes) {
    for (const action of lane.actions) actionByNode.set(action.graphNode, action);
  }
  const graphNodes = [...actionByNode.keys()];
  if (lanes.some((l) => l.actions.some((a) => a.type === "implement"))) {
    if (!graphNodes.includes("implementation_failed_gate")) graphNodes.push("implementation_failed_gate");
  }

  const firstAgent = lanes.find((l) => l.kind === "agent");
  return {
    config: parsed,
    lanes,
    columns,
    restartSteps,
    graphNodes,
    firstAgentNode: firstAgent?.graphNode ?? "triage_draft",
    laneById: new Map(lanes.map((l) => [l.id, l])),
    actionByNode,
  };
}

function displayNameFor(id: string, label: string, columnLabel?: string): string {
  if (id === "pull_request") return "PR";
  if (id === "review") return "review";
  if (id === "requirements") return "planning";
  const source = columnLabel ?? label;
  return source.toLowerCase();
}

export function laneByKey(resolved: ResolvedPipeline, key: string): ResolvedLane | undefined {
  return resolved.laneById.get(key) ?? resolved.lanes.find((l) => l.restartId === key);
}

export function laneForJobState(resolved: ResolvedPipeline, state: string): ResolvedLane | undefined {
  if (state === "inbox") return resolved.lanes.find((l) => l.kind === "intake");
  if (state.startsWith("awaiting_")) {
    const byAwaiting = resolved.lanes.find((l) => l.actions.some((a) => a.awaitingState === state));
    if (byAwaiting) return byAwaiting;
    const slug = state.replace(/^awaiting_/, "").replace(/_approval$/, "");
    return (
      resolved.lanes.find((l) => l.actions.some((a) => a.gate === slug)) ??
      laneByKey(resolved, slug === "pr" ? "pull_request" : slug)
    );
  }
  return laneByKey(resolved, state) ?? resolved.lanes.find((l) => l.state === state);
}

export function nextLane(resolved: ResolvedPipeline, state: string): ResolvedLane | undefined {
  const current = laneForJobState(resolved, state);
  if (!current?.next) return undefined;
  return resolved.laneById.get(current.next);
}

export function graphNodeForState(resolved: ResolvedPipeline, state: string): string | undefined {
  if (["done", "failed", "rejected", "paused"].includes(state)) return undefined;
  const lane = laneForJobState(resolved, state);
  if (!lane || lane.kind === "intake" || lane.kind === "terminal") return undefined;
  if (state.startsWith("awaiting_")) {
    const gate = lane.actions.find((a) => a.type === "human_approval" && a.awaitingState === state);
    return gate?.graphNode ?? lane.actions.find((a) => a.type === "human_approval")?.graphNode;
  }
  return lane.graphNode;
}

export function isRunnableLaneState(resolved: ResolvedPipeline, state: string): boolean {
  if (state.startsWith("awaiting_")) return false;
  if (["done", "failed", "rejected", "paused", "inbox"].includes(state)) return false;
  const lane = laneForJobState(resolved, state);
  return Boolean(lane && lane.kind === "agent");
}

export function displayLaneName(resolved: ResolvedPipeline, stateOrLane: string): string {
  const lane = laneForJobState(resolved, stateOrLane) ?? laneByKey(resolved, stateOrLane);
  if (!lane) return stateOrLane.replaceAll("_", " ");
  return lane.displayName;
}

export function stepIndex(resolved: ResolvedPipeline, stepOrLane: string): number {
  const lane = laneForJobState(resolved, stepOrLane) ?? laneByKey(resolved, stepOrLane);
  const id = lane?.restartId ?? stepOrLane;
  return resolved.restartSteps.findIndex((s) => s.id === id);
}

export function gateForState(resolved: ResolvedPipeline, state: string): string | null {
  if (!state.startsWith("awaiting_")) return null;
  const lane = laneForJobState(resolved, state);
  const action = lane?.actions.find((a) => a.awaitingState === state && a.type === "human_approval");
  return action?.gate ?? null;
}

export function nextStateForApprove(
  resolved: ResolvedPipeline,
  state: string,
  action: string,
): string {
  if (action === "reject") return "rejected";
  const lane = laneForJobState(resolved, state);
  if (action === "send_back") {
    const sendTo =
      lane?.actions.find((a) => a.type === "human_approval" && a.awaitingState === state)?.sendBackTo ??
      "implementation";
    return sendTo;
  }
  const nxt = nextLane(resolved, state);
  return nxt?.state ?? "done";
}

export function columnForState(
  resolved: ResolvedPipeline,
  state: string,
  last: string,
  board: string,
): string {
  if (state === "failed" || state === "paused" || state === "rejected") {
    if (board === "requirements") return "planning";
    if (board === "review") return "pull_request";
    const fromLast = laneForJobState(resolved, last);
    if (fromLast) return fromLast.column;
    const fromBoard = resolved.lanes.find((l) => l.column === board || l.id === board);
    return fromBoard?.column || resolved.columns[0]?.id || "triage";
  }
  const lane = laneForJobState(resolved, state);
  if (lane) return lane.column;
  return board || resolved.columns[0]?.id || "triage";
}

export function nextAction(resolved: ResolvedPipeline, graphNode: string): ResolvedAction | undefined {
  const current = resolved.actionByNode.get(graphNode);
  if (!current) return undefined;
  const lane = resolved.laneById.get(current.laneId);
  if (!lane) return undefined;
  const idx = lane.actions.findIndex((a) => a.graphNode === graphNode);
  if (idx >= 0 && idx < lane.actions.length - 1) return lane.actions[idx + 1];
  const nxt = nextLane(resolved, lane.id);
  return nxt?.actions[0];
}

export function firstActionOf(resolved: ResolvedPipeline, laneId: string): ResolvedAction | undefined {
  return resolved.laneById.get(laneId)?.actions[0];
}

export function artifactsFromStep(resolved: ResolvedPipeline, restartId: string): ArtifactKind[] {
  const cut = resolved.restartSteps.findIndex((s) => s.id === restartId);
  const start = cut < 0 ? 0 : cut;
  const kinds = new Set<ArtifactKind>();
  for (const step of resolved.restartSteps.slice(start)) {
    const lane = resolved.lanes.find((l) => l.restartId === step.id);
    if (!lane) continue;
    for (const action of lane.actions) {
      if (action.artifact) kinds.add(action.artifact);
    }
  }
  kinds.add("context");
  return [...kinds];
}

export const ARTIFACT_DOCS: Record<string, string[]> = {
  fr: ["requirements.mdx", "requirements.md", "requirements.visualplan.json", "plan-spec.mdx"],
  tech_spec: ["tech-spec.mdx", "tech-spec.md", "tech-spec.visualplan.json"],
  task_graph: ["tasks.json"],
  review: ["review.md", "review.json"],
  pr: ["pull-request.md"],
};

export function docsFromStep(resolved: ResolvedPipeline, restartId: string): string[] {
  const kinds = artifactsFromStep(resolved, restartId);
  const names: string[] = [];
  for (const kind of kinds) {
    names.push(...(ARTIFACT_DOCS[kind] ?? []));
  }
  return names;
}

export function publicPipeline(resolved: ResolvedPipeline) {
  return {
    version: 1 as const,
    lanes: resolved.config.lanes,
    columns: resolved.columns,
    restartSteps: resolved.restartSteps,
  };
}
