import { describe, expect, it } from "vitest";
import { END } from "@langchain/langgraph";
import { routeFromStart } from "./graph";
import { DEFAULT_PIPELINE } from "./pipeline/default";
import { resolvePipeline } from "./pipeline";

describe("routeFromStart", () => {
  it("starts a new ticket at triage", () => {
    expect(routeFromStart({ stage: "" })).toBe("triage_draft");
    expect(routeFromStart({ stage: "triage_draft" })).toBe("triage_draft");
  });

  it("does not re-run triage after a handoff (Command.goto must not fan-out)", () => {
    expect(routeFromStart({ stage: "handoff" })).toBe(END);
    expect(routeFromStart({ stage: "done" })).toBe(END);
    expect(routeFromStart({ stage: "rejected" })).toBe(END);
  });

  it("honors an explicit dest stage so restart/continue land on that node", () => {
    expect(routeFromStart({ stage: "requirements_draft" })).toBe("requirements_draft");
    expect(routeFromStart({ stage: "tech_spec_gate" })).toBe("tech_spec_gate");
  });

  it("routes a review fix node when that action is configured", () => {
    const custom = {
      ...DEFAULT_PIPELINE,
      lanes: DEFAULT_PIPELINE.lanes.map((lane) =>
        lane.id === "review"
          ? {
              ...lane,
              actions: [
                { type: "produce" as const, artifact: "review" as const, graphNode: "review_draft" },
                { type: "fix" as const, graphNode: "review_fix" },
                {
                  type: "human_approval" as const,
                  graphNode: "review_gate",
                  awaitingState: "awaiting_review_approval",
                  gate: "review",
                },
              ],
            }
          : lane,
      ),
    };
    const resolved = resolvePipeline(custom);
    expect(routeFromStart({ stage: "review_fix" }, resolved)).toBe("review_fix");
    expect(routeFromStart({ stage: "handoff" }, resolved)).toBe(END);
  });

  it("falls back to the first agent node for unknown stages", () => {
    expect(routeFromStart({ stage: "not_a_node" })).toBe("triage_draft");
  });

  it("starts a pipeline whose first agent is not triage", () => {
    const custom = {
      version: 1 as const,
      lanes: [
        { id: "intake", label: "Intake", column: "intake", kind: "intake" as const, actions: [] },
        {
          id: "implementation",
          label: "Impl",
          column: "implementation",
          actions: [{ type: "implement" as const, graphNode: "implementation" }],
        },
        { id: "done", label: "Done", column: "done", kind: "terminal" as const, actions: [] },
      ],
    };
    const resolved = resolvePipeline(custom);
    expect(routeFromStart({ stage: "" }, resolved)).toBe("implementation");
    expect(routeFromStart({ stage: "implementation" }, resolved)).toBe("implementation");
  });
});
