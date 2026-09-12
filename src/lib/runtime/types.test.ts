import { describe, expect, it } from "vitest";
import { badgeFor, columnForState, gateForState, nextStateForApprove } from "./types";
import { DEFAULT_PIPELINE } from "./pipeline/default";
import { resolvePipeline } from "./pipeline/resolve";

describe("badgeFor", () => {
  it("marks queued inbox, every awaiting_* gate, and holding states", () => {
    expect(badgeFor("inbox", true)).toBe("queued");
    expect(badgeFor("inbox", false)).toBeNull();
    expect(badgeFor("triage", true)).toBeNull();
    expect(badgeFor("awaiting_requirements_approval", false)).toBe("approval");
    expect(badgeFor("awaiting_pr_approval", false)).toBe("approval");
    expect(badgeFor("failed", false)).toBe("failed");
    expect(badgeFor("paused", false)).toBe("paused");
    expect(badgeFor("rejected", false)).toBe("rejected");
    expect(badgeFor("done", false)).toBeNull();
    expect(badgeFor("implementation", false)).toBeNull();
  });
});

describe("types wrappers use the default pipeline", () => {
  it("mirrors resolve helpers without an explicit pipeline", () => {
    expect(gateForState("awaiting_review_approval")).toBe("review");
    expect(gateForState("implementation")).toBeNull();
    expect(nextStateForApprove("awaiting_tasks_approval", "approve")).toBe("implementation");
    expect(nextStateForApprove("awaiting_review_approval", "send_back")).toBe("implementation");
    expect(nextStateForApprove("awaiting_pr_approval", "reject")).toBe("rejected");
    expect(columnForState("awaiting_requirements_approval", "requirements", "planning")).toBe("planning");
    expect(columnForState("done", "pull_request", "pull_request")).toBe("done");
  });

  it("honors a custom pipeline for approve and send-back", () => {
    const p = resolvePipeline({
      version: 1,
      lanes: DEFAULT_PIPELINE.lanes.filter((l) => l.id !== "tech_spec"),
    });
    expect(nextStateForApprove("awaiting_requirements_approval", "approve", p)).toBe("tasks");
    expect(columnForState("awaiting_requirements_approval", "requirements", "planning", p)).toBe("planning");
  });
});
