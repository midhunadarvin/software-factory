import type { BoardColumn, JobState } from "./types";

export type LaneKey =
  | "intake"
  | "triage"
  | "requirements"
  | "tech_spec"
  | "tasks"
  | "implementation"
  | "review"
  | "pull_request"
  | "done";

export type LaneDef = {
  key: LaneKey;
  state: JobState;
  column: BoardColumn;
  graphNode: string;
  next: LaneKey | null;
};

export const LANES: LaneDef[] = [
  { key: "intake", state: "intake", column: "intake", graphNode: "intake", next: "triage" },
  { key: "triage", state: "triage", column: "triage", graphNode: "triage_draft", next: "requirements" },
  {
    key: "requirements",
    state: "requirements",
    column: "planning",
    graphNode: "requirements_draft",
    next: "tech_spec",
  },
  { key: "tech_spec", state: "tech_spec", column: "tech_spec", graphNode: "tech_spec_draft", next: "tasks" },
  { key: "tasks", state: "tasks", column: "tasks", graphNode: "tasks_draft", next: "implementation" },
  {
    key: "implementation",
    state: "implementation",
    column: "implementation",
    graphNode: "implementation",
    next: "review",
  },
  { key: "review", state: "review", column: "pull_request", graphNode: "review_draft", next: "pull_request" },
  {
    key: "pull_request",
    state: "pull_request",
    column: "pull_request",
    graphNode: "pull_request",
    next: "done",
  },
  { key: "done", state: "done", column: "done", graphNode: "done", next: null },
];

const BY_KEY = new Map(LANES.map((l) => [l.key, l]));

export function laneByKey(key: string): LaneDef | undefined {
  return BY_KEY.get(key as LaneKey);
}

export function laneForJobState(state: string): LaneDef | undefined {
  if (state === "inbox") return BY_KEY.get("intake");
  if (state === "awaiting_requirements_approval") return BY_KEY.get("requirements");
  if (state === "awaiting_tech_spec_approval") return BY_KEY.get("tech_spec");
  if (state === "awaiting_tasks_approval") return BY_KEY.get("tasks");
  if (state === "awaiting_review_approval") return BY_KEY.get("review");
  if (state === "awaiting_pr_approval") return BY_KEY.get("pull_request");
  return LANES.find((l) => l.state === state);
}

export function nextLane(state: string): LaneDef | undefined {
  const current = laneForJobState(state);
  if (!current?.next) return undefined;
  return BY_KEY.get(current.next);
}

export function graphNodeForState(state: string): string | undefined {
  if (["done", "failed", "rejected", "paused", "intake", "inbox"].includes(state)) return undefined;
  if (state === "awaiting_pr_approval") return "pr_gate";
  return laneForJobState(state)?.graphNode;
}

export const RESTART_STEPS = [
  { id: "intake", label: "Intake", state: "intake" as const, column: "intake" as const },
  { id: "triage", label: "Triage", state: "triage" as const, column: "triage" as const },
  { id: "planning", label: "Planning", state: "requirements" as const, column: "planning" as const },
  { id: "tech_spec", label: "Tech spec", state: "tech_spec" as const, column: "tech_spec" as const },
  { id: "tasks", label: "Tasks", state: "tasks" as const, column: "tasks" as const },
  { id: "implementation", label: "Implementation", state: "implementation" as const, column: "implementation" as const },
  { id: "review", label: "Review", state: "review" as const, column: "pull_request" as const },
] as const;

export type RestartStepId = (typeof RESTART_STEPS)[number]["id"];

export function displayLaneName(stateOrLane: string): string {
  const lane = laneForJobState(stateOrLane) ?? laneByKey(stateOrLane);
  if (!lane) return stateOrLane.replaceAll("_", " ");
  if (lane.column === "planning") return "planning";
  if (lane.column === "tech_spec") return "tech spec";
  if (lane.column === "pull_request") return lane.key === "review" ? "review" : "PR";
  if (lane.column === "done") return "done";
  if (lane.column === "intake") return "intake";
  return lane.column.replaceAll("_", " ");
}

export function stepIndex(stepOrLane: string): number {
  const id =
    stepOrLane === "requirements"
      ? "planning"
      : stepOrLane === "pull_request"
        ? "review"
        : stepOrLane === "inbox"
          ? "intake"
          : stepOrLane;
  return RESTART_STEPS.findIndex((s) => s.id === id);
}

export function isRunnableLaneState(state: string): boolean {
  return [
    "triage",
    "requirements",
    "tech_spec",
    "tasks",
    "implementation",
    "review",
    "pull_request",
  ].includes(state);
}
