import type { PipelineConfig } from "./schema";

/**
 * Built-in factory: same lanes, gates, and handoffs as the original hardcoded graph.
 * Review is produce → human approval (no auto-fix). Add a `fix` action to change that.
 */
export const DEFAULT_PIPELINE: PipelineConfig = {
  version: 1,
  lanes: [
    { id: "intake", label: "Intake", column: "intake", kind: "intake", actions: [] },
    {
      id: "triage",
      label: "Triage",
      column: "triage",
      actions: [{ type: "produce", artifact: "triage", graphNode: "triage_draft", handoff: true }],
    },
    {
      id: "requirements",
      label: "Planning",
      column: "planning",
      columnLabel: "Planning",
      restartId: "planning",
      actions: [
        { type: "produce", artifact: "fr", graphNode: "requirements_draft" },
        {
          type: "human_approval",
          graphNode: "requirements_gate",
          awaitingState: "awaiting_requirements_approval",
          gate: "requirements",
        },
      ],
    },
    {
      id: "tech_spec",
      label: "Tech spec",
      column: "tech_spec",
      columnLabel: "Tech spec",
      actions: [
        { type: "produce", artifact: "tech_spec", graphNode: "tech_spec_draft" },
        {
          type: "human_approval",
          graphNode: "tech_spec_gate",
          awaitingState: "awaiting_tech_spec_approval",
          gate: "tech_spec",
        },
      ],
    },
    {
      id: "tasks",
      label: "Tasks",
      column: "tasks",
      actions: [
        { type: "produce", artifact: "task_graph", graphNode: "tasks_draft", handoff: true },
        {
          type: "human_approval",
          graphNode: "tasks_gate",
          awaitingState: "awaiting_tasks_approval",
          gate: "tasks",
          skipIf: "fast_track",
        },
      ],
    },
    {
      id: "implementation",
      label: "Implementation",
      column: "implementation",
      queue: "impl",
      actions: [{ type: "implement", graphNode: "implementation" }],
    },
    {
      id: "review",
      label: "Review",
      column: "pull_request",
      columnLabel: "PR",
      hidden: true,
      actions: [
        { type: "produce", artifact: "review", graphNode: "review_draft" },
        {
          type: "human_approval",
          graphNode: "review_gate",
          awaitingState: "awaiting_review_approval",
          gate: "review",
          skipIf: "fast_track",
          allowSendBack: true,
          sendBackTo: "implementation",
        },
      ],
    },
    {
      id: "pull_request",
      label: "PR",
      column: "pull_request",
      columnLabel: "PR",
      actions: [
        { type: "produce", artifact: "pr", graphNode: "pull_request" },
        {
          type: "human_approval",
          graphNode: "pr_gate",
          awaitingState: "awaiting_pr_approval",
          gate: "pr",
        },
        { type: "publish" },
      ],
    },
    { id: "done", label: "Done", column: "done", kind: "terminal", actions: [] },
  ],
};
