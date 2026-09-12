import { describe, expect, it } from "vitest";
import { skillFor } from "./skills";

describe("skillFor", () => {
  it("returns a distinct built-in prompt for every default lane plus fix", () => {
    const lanes = [
      "triage",
      "requirements",
      "tech_spec",
      "tasks",
      "implementation",
      "review",
      "fix",
      "pull_request",
    ] as const;
    const texts = lanes.map((l) => skillFor(l));
    expect(new Set(texts).size).toBe(lanes.length);
    expect(skillFor("triage")).toMatch(/setRisk/);
    expect(skillFor("requirements")).toMatch(/requestHumanReview/);
    expect(skillFor("tech_spec")).toMatch(/requestHumanReview/);
    expect(skillFor("tasks")).toMatch(/submitArtifact/);
    expect(skillFor("implementation")).toMatch(/gitCommit/);
    expect(skillFor("review")).toMatch(/verdict/);
    expect(skillFor("fix")).toMatch(/review findings/);
    expect(skillFor("pull_request")).toMatch(/pull request/i);
  });

  it("falls back to the implementation skill for unknown lanes", () => {
    expect(skillFor("custom_lane")).toBe(skillFor("implementation"));
  });

  it("prefers a non-empty override", () => {
    expect(skillFor("review", "  only fix blockers  ")).toBe("only fix blockers");
    expect(skillFor("review", "   ")).toBe(skillFor("review"));
    expect(skillFor("review", "")).toBe(skillFor("review"));
  });
});
