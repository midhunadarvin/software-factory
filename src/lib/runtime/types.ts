import { resolvedPipeline } from "./lanes";
import {
  columnForState as columnForStateResolved,
  gateForState as gateForStateResolved,
  nextStateForApprove as nextStateForApproveResolved,
  type ResolvedPipeline,
} from "./pipeline/resolve";

export type JobState = string;
export type BoardColumn = string;

export type Badge = "approval" | "failed" | "paused" | "rejected" | "queued" | null;

export type HitlResume =
  | {
      action: "approve";
      artifact?: unknown;
      note?: string;
      draft?: boolean;
    }
  | { action: "send_back"; note: string }
  | { action: "reject"; note: string }
  | { action: "retry" };

export function gateForState(state: string, pipeline?: ResolvedPipeline): string | null {
  return gateForStateResolved(resolvedPipeline(pipeline), state);
}

export function nextStateForApprove(state: string, action: string, pipeline?: ResolvedPipeline): JobState {
  return nextStateForApproveResolved(resolvedPipeline(pipeline), state, action);
}

export function columnForState(
  state: string,
  last: string,
  board: string,
  pipeline?: ResolvedPipeline,
): BoardColumn {
  return columnForStateResolved(resolvedPipeline(pipeline), state, last, board);
}

export function badgeFor(state: string, queued: boolean): Badge {
  if (queued && state === "inbox") return "queued";
  if (state.startsWith("awaiting_")) return "approval";
  if (state === "failed") return "failed";
  if (state === "paused") return "paused";
  if (state === "rejected") return "rejected";
  return null;
}
