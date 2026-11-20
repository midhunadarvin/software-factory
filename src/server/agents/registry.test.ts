import { afterEach, describe, expect, it } from "vitest";
import {
  agentForArtifact,
  agentMaxSteps,
  getAgent,
  listAgents,
  loadBuiltinAgents,
  registerAgent,
  resolveAgentSystem,
  skillFor,
  unregisterAgent,
} from "./index";
import type { AgentDefinition } from "./types";

const extra: AgentDefinition = {
  id: "security",
  label: "Security",
  skill: "You audit for secrets.",
  exitHint: "Call submitArtifact once, then stop.",
  tools: ["repo.read", "submit_artifact"],
  maxSteps: 8,
};

afterEach(() => {
  unregisterAgent("security");
  loadBuiltinAgents();
});

describe("agent SDK catalog", () => {
  it("loads the factory lane agents by default", () => {
    expect(listAgents().map((a) => a.id)).toEqual([
      "triage",
      "requirements",
      "tech_spec",
      "tasks",
      "implementation",
      "review",
      "fix",
      "pull_request",
    ]);
    expect(agentForArtifact("fr")?.id).toBe("requirements");
    expect(agentForArtifact("review")?.id).toBe("review");
    expect(skillFor("triage")).toMatch(/setRisk/);
    expect(skillFor("missing")).toBe(skillFor("implementation"));
    expect(agentMaxSteps("tasks")).toBe(6);
    expect(agentMaxSteps("implementation")).toBe(20);
  });

  it("registers a third-party agent without editing the factory", () => {
    registerAgent(extra);
    expect(getAgent("security")?.label).toBe("Security");
    expect(resolveAgentSystem("security")).toContain("You audit for secrets.");
    expect(resolveAgentSystem("security")).toContain("submitArtifact");
  });

  it("rejects a bad agent id", () => {
    expect(() => registerAgent({ ...extra, id: "Nope" })).toThrow(/invalid agent id/);
  });

  it("prefers a skill override", () => {
    expect(skillFor("review", "  only blockers  ")).toBe("only blockers");
    expect(resolveAgentSystem("review", "only blockers")).toContain("only blockers");
    expect(resolveAgentSystem("review", "only blockers")).not.toContain(skillFor("review"));
  });
});
