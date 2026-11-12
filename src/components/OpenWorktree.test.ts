import { describe, expect, it } from "vitest";
import { afterPlanningLane } from "./OpenWorktree";

describe("afterPlanningLane", () => {
  it("hides intake, triage, and planning", () => {
    expect(afterPlanningLane("intake", "intake")).toBe(false);
    expect(afterPlanningLane("triage", "triage")).toBe(false);
    expect(afterPlanningLane("planning", "awaiting_requirements_approval")).toBe(false);
  });

  it("shows tech spec through done", () => {
    expect(afterPlanningLane("tech_spec", "awaiting_tech_spec_approval")).toBe(true);
    expect(afterPlanningLane("tasks", "tasks")).toBe(true);
    expect(afterPlanningLane("implementation", "implementation")).toBe(true);
    expect(afterPlanningLane("pull_request", "awaiting_review_approval")).toBe(true);
    expect(afterPlanningLane("pull_request", "awaiting_pr_approval")).toBe(true);
    expect(afterPlanningLane("done", "done")).toBe(true);
  });
});
