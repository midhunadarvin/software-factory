export type AgentArtifactKind = "triage" | "fr" | "tech_spec" | "task_graph" | "review" | "pr";

export type AgentToolKit = "ticket" | "repo.read" | "repo.write" | "repo.exec" | "human_review" | "submit_artifact";

export type AgentDefinition = {
  id: string;
  label: string;
  /** System skill. Hosts must not rewrite this; override via registerAgent. */
  skill: string;
  /** Extra exit line appended after the untrusted-data rule. */
  exitHint: string;
  tools: AgentToolKit[];
  artifact?: AgentArtifactKind;
  maxSteps: number;
};

export type AgentHostPart = {
  type: "thinking" | "text" | "tool";
  delta: string;
  tool?: string;
};

/** Host-supplied LLM + tools. The SDK does not talk to a provider directly. */
export type AgentHost = {
  completeText: (opts: {
    system: string;
    prompt: string;
    maxSteps: number;
    onPart?: (part: AgentHostPart) => void;
  }) => Promise<string>;
};
