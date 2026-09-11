import { describe, expect, it } from "vitest";
import { displayLaneName, graphNodeForState, isRunnableLaneState, laneForJobState, nextLane } from "./lanes";
import { columnForState, gateForState, nextStateForApprove } from "./types";

describe("ticket lanes", () => {
  it("maps each job state to a graph node", () => {
    expect(graphNodeForState("inbox")).toBeUndefined();
    expect(graphNodeForState("intake")).toBeUndefined();
    expect(graphNodeForState("triage")).toBe("triage_draft");
    expect(graphNodeForState("requirements")).toBe("requirements_draft");
    expect(graphNodeForState("tech_spec")).toBe("tech_spec_draft");
    expect(graphNodeForState("tasks")).toBe("tasks_draft");
    expect(graphNodeForState("implementation")).toBe("implementation");
    expect(graphNodeForState("review")).toBe("review_draft");
    expect(graphNodeForState("pull_request")).toBe("pull_request");
    expect(graphNodeForState("done")).toBeUndefined();
  });

  it("advances triage → planning → spec → tasks → implementation → review → PR", () => {
    expect(nextLane("intake")?.key).toBe("triage");
    expect(nextLane("triage")?.key).toBe("requirements");
    expect(nextLane("requirements")?.column).toBe("tech_spec");
    expect(nextLane("tech_spec")?.key).toBe("tasks");
    expect(nextLane("tasks")?.key).toBe("implementation");
    expect(nextLane("implementation")?.key).toBe("review");
    expect(nextLane("review")?.key).toBe("pull_request");
    expect(nextLane("pull_request")?.key).toBe("done");
    expect(nextLane("done")).toBeUndefined();
  });

  it("treats inbox as intake and parked gates as their lane", () => {
    expect(laneForJobState("inbox")?.key).toBe("intake");
    expect(laneForJobState("intake")?.key).toBe("intake");
    expect(laneForJobState("awaiting_requirements_approval")?.key).toBe("requirements");
    expect(isRunnableLaneState("requirements")).toBe(true);
    expect(isRunnableLaneState("awaiting_review_approval")).toBe(false);
    expect(isRunnableLaneState("done")).toBe(false);
    expect(isRunnableLaneState("intake")).toBe(false);
  });

  it("names the board lane from job state, not lastActiveState", () => {
    expect(displayLaneName("requirements")).toBe("planning");
    expect(displayLaneName("triage")).toBe("triage");
    expect(displayLaneName("tech_spec")).toBe("tech spec");
    expect(displayLaneName("done")).toBe("done");
    expect(displayLaneName("intake")).toBe("intake");
  });

  it("puts a finished ticket on the Done column, not PR", () => {
    expect(columnForState("intake", "intake", "intake")).toBe("intake");
    expect(columnForState("done", "pull_request", "pull_request")).toBe("done");
    expect(columnForState("awaiting_pr_approval", "pull_request", "pull_request")).toBe("pull_request");
    expect(nextLane("pull_request")?.column).toBe("done");
    expect(gateForState("awaiting_pr_approval")).toBe("pr");
    expect(nextStateForApprove("awaiting_pr_approval", "approve")).toBe("done");
    expect(graphNodeForState("awaiting_pr_approval")).toBe("pr_gate");
  });
});
