export { skillFor } from "@software-factory/agent-sdk";
export type { AgentDefinition } from "@software-factory/agent-sdk";

export type BuiltInLaneId =
  | "triage"
  | "requirements"
  | "tech_spec"
  | "tasks"
  | "implementation"
  | "review"
  | "pull_request"
  | "fix";

export type LaneId = string;
