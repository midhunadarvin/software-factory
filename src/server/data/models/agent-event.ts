export type AgentEventLevel = "debug" | "info" | "warn" | "error";

export type AgentEvent = {
  id: string;
  jobId: string | null;
  projectId: string;
  level: string;
  event: string;
  /** JSON-encoded, already redacted. */
  payload: string;
  createdAt: string;
};
