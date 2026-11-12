import { describe, expect, it } from "vitest";
import { skillFor } from "@software-factory/agent-sdk";
import { catalogAgentIdForAction, defaultSkillForAction, storedSkillForAction } from "./action-skill";

describe("defaultSkillForAction", () => {
  it("maps produce artifacts and implement/fix to catalog agents", () => {
    expect(catalogAgentIdForAction("planning", { type: "produce", artifact: "fr" })).toBe("requirements");
    expect(catalogAgentIdForAction("review", { type: "produce", artifact: "review" })).toBe("review");
    expect(catalogAgentIdForAction("implementation", { type: "implement" })).toBe("implementation");
    expect(catalogAgentIdForAction("review", { type: "fix" })).toBe("fix");
    expect(defaultSkillForAction("review", { type: "produce", artifact: "review" })).toBe(skillFor("review"));
    expect(defaultSkillForAction("implementation", { type: "implement" })).toMatch(/gitCommit/);
  });

  it("stores an override only when the text differs from the catalog skill", () => {
    const def = defaultSkillForAction("tasks", { type: "produce", artifact: "task_graph" });
    expect(storedSkillForAction("tasks", { type: "produce", artifact: "task_graph" }, def)).toBeUndefined();
    expect(storedSkillForAction("tasks", { type: "produce", artifact: "task_graph" }, `  ${def}  `)).toBeUndefined();
    expect(storedSkillForAction("tasks", { type: "produce", artifact: "task_graph" }, "")).toBeUndefined();
    expect(storedSkillForAction("tasks", { type: "produce", artifact: "task_graph" }, "Keep tasks tiny.")).toBe(
      "Keep tasks tiny.",
    );
  });
});
