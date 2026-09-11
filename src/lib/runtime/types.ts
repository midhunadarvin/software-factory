export type JobState =
  | "inbox"
  | "intake"
  | "triage"
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
  | "awaiting_pr_approval"
  | "done"
  | "failed"
  | "rejected"
  | "paused";

export type BoardColumn =
  | "intake"
  | "triage"
  | "planning"
  | "tech_spec"
  | "tasks"
  | "implementation"
  | "pull_request"
  | "done";

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

export function gateForState(
  state: string,
): "requirements" | "tech_spec" | "tasks" | "review" | "pr" | null {
  if (state === "awaiting_requirements_approval") return "requirements";
  if (state === "awaiting_tech_spec_approval") return "tech_spec";
  if (state === "awaiting_tasks_approval") return "tasks";
  if (state === "awaiting_review_approval") return "review";
  if (state === "awaiting_pr_approval") return "pr";
  return null;
}

export function nextStateForApprove(state: string, action: string): JobState {
  if (action === "reject") return "rejected";
  if (action === "send_back") return "implementation";
  if (state === "awaiting_requirements_approval") return "tech_spec";
  if (state === "awaiting_tech_spec_approval") return "tasks";
  if (state === "awaiting_tasks_approval") return "implementation";
  if (state === "awaiting_review_approval") return "pull_request";
  if (state === "awaiting_pr_approval") return "done";
  return state as JobState;
}

export function columnForState(state: string, last: string, board: string): BoardColumn {
  if (state === "failed" || state === "paused" || state === "rejected") {
    if (board === "requirements" || board === "review") {
      return board === "requirements" ? "planning" : "pull_request";
    }
    return (board as BoardColumn) || "triage";
  }
  void last;
  if (state === "inbox" || state === "intake") return "intake";
  if (state === "triage") return "triage";
  if (state === "requirements" || state === "awaiting_requirements_approval") return "planning";
  if (state === "tech_spec" || state === "awaiting_tech_spec_approval") return "tech_spec";
  if (state === "tasks" || state === "awaiting_tasks_approval") return "tasks";
  if (state === "implementation") return "implementation";
  if (state === "done") return "done";
  if (
    state === "review" ||
    state === "awaiting_review_approval" ||
    state === "pull_request" ||
    state === "awaiting_pr_approval"
  ) {
    return "pull_request";
  }
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
