export type JobState =
  | "inbox"
  | "requirements"
  | "awaiting_requirements_approval"
  | "tech_spec"
  | "awaiting_tech_spec_approval"
  | "tasks"
  | "awaiting_tasks_approval"
  | "implementation"
  | "review"
  | "awaiting_review_approval"
  | "pull_request"
  | "done"
  | "failed"
  | "rejected"
  | "paused";

export type BoardColumn =
  | "requirements"
  | "tech_spec"
  | "tasks"
  | "implementation"
  | "review"
  | "pull_request";

export type Badge = "approval" | "failed" | "paused" | "rejected" | "queued" | null;

export type HitlResume =
  | {
      action: "approve";
      artifact?: unknown;
      note?: string;
    }
  | { action: "send_back"; note: string }
  | { action: "reject"; note: string }
  | { action: "retry" };

export function gateForState(state: string): "requirements" | "tech_spec" | "tasks" | "review" | null {
  if (state === "awaiting_requirements_approval") return "requirements";
  if (state === "awaiting_tech_spec_approval") return "tech_spec";
  if (state === "awaiting_tasks_approval") return "tasks";
  if (state === "awaiting_review_approval") return "review";
  return null;
}

export function nextStateForApprove(state: string, action: string): JobState {
  if (action === "reject") return "rejected";
  if (action === "send_back") return "implementation";
  if (state === "awaiting_requirements_approval") return "tech_spec";
  if (state === "awaiting_tech_spec_approval") return "tasks";
  if (state === "awaiting_tasks_approval") return "implementation";
  if (state === "awaiting_review_approval") return "pull_request";
  return state as JobState;
}

export function columnForState(state: string, last: string, board: string): BoardColumn {
  if (
    state === "failed" ||
    state === "paused" ||
    state === "rejected"
  ) {
    return board as BoardColumn;
  }
  void last;
  if (state === "inbox" || state === "requirements" || state === "awaiting_requirements_approval") {
    return "requirements";
  }
  if (state === "tech_spec" || state === "awaiting_tech_spec_approval") return "tech_spec";
  if (state === "tasks" || state === "awaiting_tasks_approval") return "tasks";
  if (state === "implementation") return "implementation";
  if (state === "review" || state === "awaiting_review_approval") return "review";
  return "pull_request";
}

export function badgeFor(state: string, queued: boolean): Badge {
  if (queued && state === "inbox") return "queued";
  if (state.startsWith("awaiting_")) return "approval";
  if (state === "failed") return "failed";
  if (state === "paused") return "paused";
  if (state === "rejected") return "rejected";
  return null;
}
