import { DEFAULT_PIPELINE } from "./pipeline/default";
import {
  displayLaneName as displayLaneNameResolved,
  graphNodeForState as graphNodeForStateResolved,
  isRunnableLaneState as isRunnableLaneStateResolved,
  laneByKey as laneByKeyResolved,
  laneForJobState as laneForJobStateResolved,
  nextLane as nextLaneResolved,
  resolvePipeline,
  stepIndex as stepIndexResolved,
  type ResolvedLane,
  type ResolvedPipeline,
  type RestartStep,
} from "./pipeline/resolve";
export type LaneKey = string;

export type LaneDef = {
  key: string;
  state: string;
  column: string;
  graphNode: string;
  next: string | null;
};

const DEFAULT_RESOLVED = resolvePipeline(DEFAULT_PIPELINE);

function asLaneDef(lane: ResolvedLane): LaneDef {
  return {
    key: lane.id,
    state: lane.state,
    column: lane.column,
    graphNode: lane.graphNode,
    next: lane.next,
  };
}

export const LANES: LaneDef[] = DEFAULT_RESOLVED.lanes.map(asLaneDef);

export const RESTART_STEPS: readonly RestartStep[] = DEFAULT_RESOLVED.restartSteps;

export type RestartStepId = string;

export function resolvedPipeline(pipeline?: ResolvedPipeline): ResolvedPipeline {
  return pipeline ?? DEFAULT_RESOLVED;
}

export function laneByKey(key: string, pipeline?: ResolvedPipeline): LaneDef | undefined {
  const lane = laneByKeyResolved(resolvedPipeline(pipeline), key);
  return lane ? asLaneDef(lane) : undefined;
}

export function laneForJobState(state: string, pipeline?: ResolvedPipeline): LaneDef | undefined {
  const lane = laneForJobStateResolved(resolvedPipeline(pipeline), state);
  return lane ? asLaneDef(lane) : undefined;
}

export function nextLane(state: string, pipeline?: ResolvedPipeline): LaneDef | undefined {
  const lane = nextLaneResolved(resolvedPipeline(pipeline), state);
  return lane ? asLaneDef(lane) : undefined;
}

export function graphNodeForState(state: string, pipeline?: ResolvedPipeline): string | undefined {
  return graphNodeForStateResolved(resolvedPipeline(pipeline), state);
}

export function displayLaneName(stateOrLane: string, pipeline?: ResolvedPipeline): string {
  return displayLaneNameResolved(resolvedPipeline(pipeline), stateOrLane);
}

export function stepIndex(stepOrLane: string, pipeline?: ResolvedPipeline): number {
  return stepIndexResolved(resolvedPipeline(pipeline), stepOrLane);
}

export function isRunnableLaneState(state: string, pipeline?: ResolvedPipeline): boolean {
  return isRunnableLaneStateResolved(resolvedPipeline(pipeline), state);
}
