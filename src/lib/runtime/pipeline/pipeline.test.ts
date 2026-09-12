import { describe, expect, it } from "vitest";
import { DEFAULT_PIPELINE } from "./default";
import {
  artifactsFromStep,
  columnForState,
  displayLaneName,
  gateForState,
  graphNodeForState,
  isRunnableLaneState,
  laneForJobState,
  nextAction,
  nextLane,
  nextStateForApprove,
  parsePipeline,
  resolvePipeline,
  docsFromStep,
  firstActionOf,
  laneByKey,
  publicPipeline,
  stepIndex,
  tryParsePipeline,
} from "./resolve";
import { PipelineConfigSchema, type PipelineConfig } from "./schema";

describe("default pipeline", () => {
  const p = resolvePipeline(DEFAULT_PIPELINE);

  it("exposes the current board columns", () => {
    expect(p.columns.map((c) => c.id)).toEqual([
      "intake",
      "triage",
      "planning",
      "tech_spec",
      "tasks",
      "implementation",
      "pull_request",
      "done",
    ]);
    expect(p.lanes.find((l) => l.id === "review")?.hidden).toBe(true);
  });

  it("keeps the original graph node names", () => {
    expect(graphNodeForState(p, "triage")).toBe("triage_draft");
    expect(graphNodeForState(p, "requirements")).toBe("requirements_draft");
    expect(graphNodeForState(p, "tech_spec")).toBe("tech_spec_draft");
    expect(graphNodeForState(p, "tasks")).toBe("tasks_draft");
    expect(graphNodeForState(p, "implementation")).toBe("implementation");
    expect(graphNodeForState(p, "review")).toBe("review_draft");
    expect(graphNodeForState(p, "pull_request")).toBe("pull_request");
    expect(graphNodeForState(p, "awaiting_pr_approval")).toBe("pr_gate");
    expect(graphNodeForState(p, "intake")).toBeUndefined();
    expect(graphNodeForState(p, "done")).toBeUndefined();
    expect(p.graphNodes).toContain("tasks_gate");
    expect(p.graphNodes).toContain("implementation_failed_gate");
  });

  it("advances triage → planning → spec → tasks → implementation → review → PR → done", () => {
    expect(nextLane(p, "intake")?.id).toBe("triage");
    expect(nextLane(p, "triage")?.id).toBe("requirements");
    expect(nextLane(p, "requirements")?.column).toBe("tech_spec");
    expect(nextLane(p, "tech_spec")?.id).toBe("tasks");
    expect(nextLane(p, "tasks")?.id).toBe("implementation");
    expect(nextLane(p, "implementation")?.id).toBe("review");
    expect(nextLane(p, "review")?.id).toBe("pull_request");
    expect(nextLane(p, "pull_request")?.id).toBe("done");
    expect(nextLane(p, "done")).toBeUndefined();
  });

  it("maps parked gates back to their lane", () => {
    expect(laneForJobState(p, "inbox")?.id).toBe("intake");
    expect(laneForJobState(p, "awaiting_requirements_approval")?.id).toBe("requirements");
    expect(laneForJobState(p, "awaiting_review_approval")?.id).toBe("review");
    expect(gateForState(p, "awaiting_pr_approval")).toBe("pr");
    expect(nextStateForApprove(p, "awaiting_pr_approval", "approve")).toBe("done");
    expect(nextStateForApprove(p, "awaiting_review_approval", "send_back")).toBe("implementation");
    expect(isRunnableLaneState(p, "requirements")).toBe(true);
    expect(isRunnableLaneState(p, "awaiting_review_approval")).toBe(false);
  });

  it("names lanes the way the board already does", () => {
    expect(displayLaneName(p, "requirements")).toBe("planning");
    expect(displayLaneName(p, "triage")).toBe("triage");
    expect(displayLaneName(p, "tech_spec")).toBe("tech spec");
    expect(displayLaneName(p, "review")).toBe("review");
    expect(displayLaneName(p, "pull_request")).toBe("PR");
    expect(columnForState(p, "done", "pull_request", "pull_request")).toBe("done");
    expect(columnForState(p, "awaiting_pr_approval", "pull_request", "pull_request")).toBe("pull_request");
  });

  it("clears later artifacts when restarting from planning", () => {
    expect(artifactsFromStep(p, "planning")).toEqual([
      "fr",
      "tech_spec",
      "task_graph",
      "review",
      "pr",
      "context",
    ]);
  });
});

describe("custom pipeline", () => {
  it("lets review run review → fix → human approval", () => {
    const custom: PipelineConfig = {
      version: 1,
      lanes: DEFAULT_PIPELINE.lanes.map((lane) =>
        lane.id === "review"
          ? {
              ...lane,
              actions: [
                { type: "produce", artifact: "review", graphNode: "review_draft" },
                { type: "fix", graphNode: "review_fix" },
                {
                  type: "human_approval",
                  graphNode: "review_gate",
                  awaitingState: "awaiting_review_approval",
                  gate: "review",
                  allowSendBack: true,
                  sendBackTo: "implementation",
                },
              ],
            }
          : lane,
      ),
    };
    const p = resolvePipeline(custom);
    const review = p.laneById.get("review")!;
    expect(review.actions.map((a) => a.type)).toEqual(["produce", "fix", "human_approval"]);
    expect(nextAction(p, "review_draft")?.graphNode).toBe("review_fix");
    expect(nextAction(p, "review_fix")?.graphNode).toBe("review_gate");
  });

  it("rejects a pipeline with no intake", () => {
    const parsed = PipelineConfigSchema.safeParse({
      version: 1,
      lanes: [{ id: "done", label: "Done", column: "done", kind: "terminal", actions: [] }],
    });
    expect(parsed.success).toBe(false);
  });

  it("surfaces a parse error instead of throwing", () => {
    const result = tryParsePipeline({ version: 1, lanes: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("round-trips the default JSON", () => {
    expect(parsePipeline(JSON.stringify(DEFAULT_PIPELINE))).toEqual(DEFAULT_PIPELINE);
  });

  it("treats empty / null config as the built-in default", () => {
    expect(parsePipeline(null)).toEqual(DEFAULT_PIPELINE);
    expect(parsePipeline("")).toEqual(DEFAULT_PIPELINE);
    expect(parsePipeline(undefined)).toEqual(DEFAULT_PIPELINE);
  });

  it("rejects duplicate lane ids, produce without artifact, and missing done", () => {
    expect(
      PipelineConfigSchema.safeParse({
        version: 1,
        lanes: [
          { id: "intake", label: "Intake", column: "intake", kind: "intake", actions: [] },
          { id: "intake", label: "Dup", column: "x", actions: [] },
          { id: "done", label: "Done", column: "done", kind: "terminal", actions: [] },
        ],
      }).success,
    ).toBe(false);
    expect(
      PipelineConfigSchema.safeParse({
        version: 1,
        lanes: [
          { id: "intake", label: "Intake", column: "intake", kind: "intake", actions: [] },
          { id: "review", label: "Review", column: "review", actions: [{ type: "produce" }] },
          { id: "done", label: "Done", column: "done", kind: "terminal", actions: [] },
        ],
      }).success,
    ).toBe(false);
    expect(
      PipelineConfigSchema.safeParse({
        version: 1,
        lanes: [{ id: "intake", label: "Intake", column: "intake", kind: "intake", actions: [] }],
      }).success,
    ).toBe(false);
    expect(PipelineConfigSchema.safeParse({ version: 2, lanes: DEFAULT_PIPELINE.lanes }).success).toBe(false);
    expect(PipelineConfigSchema.safeParse({ version: 1, lanes: [{ id: "BadId", label: "X", column: "x" }] }).success).toBe(
      false,
    );
  });

  it("rejects sendBackTo that is not a lane", () => {
    const parsed = PipelineConfigSchema.safeParse({
      version: 1,
      lanes: [
        { id: "intake", label: "Intake", column: "intake", kind: "intake", actions: [] },
        {
          id: "review",
          label: "Review",
          column: "review",
          actions: [{ type: "human_approval", sendBackTo: "nope" }],
        },
        { id: "done", label: "Done", column: "done", kind: "terminal", actions: [] },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("allows sendBackTo a later lane", () => {
    const parsed = PipelineConfigSchema.safeParse({
      version: 1,
      lanes: [
        { id: "intake", label: "Intake", column: "intake", kind: "intake", actions: [] },
        {
          id: "review",
          label: "Review",
          column: "review",
          actions: [{ type: "human_approval", sendBackTo: "implementation" }],
        },
        {
          id: "implementation",
          label: "Impl",
          column: "implementation",
          actions: [{ type: "implement" }],
        },
        { id: "done", label: "Done", column: "done", kind: "terminal", actions: [] },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("skips a planning lane so requirements approve goes to tasks", () => {
    const custom: PipelineConfig = {
      version: 1,
      lanes: DEFAULT_PIPELINE.lanes.filter((l) => l.id !== "tech_spec"),
    };
    const p = resolvePipeline(custom);
    expect(nextLane(p, "requirements")?.id).toBe("tasks");
    expect(nextStateForApprove(p, "awaiting_requirements_approval", "approve")).toBe("tasks");
    expect(nextAction(p, "requirements_gate")?.graphNode).toBe("tasks_draft");
  });

  it("drops human approval so produce handoff is the only step", () => {
    const custom: PipelineConfig = {
      version: 1,
      lanes: DEFAULT_PIPELINE.lanes.map((lane) =>
        lane.id === "requirements" ? { ...lane, actions: [{ type: "produce", artifact: "fr", handoff: true }] } : lane,
      ),
    };
    const p = resolvePipeline(custom);
    expect(p.laneById.get("requirements")?.actions.map((a) => a.type)).toEqual(["produce"]);
    expect(gateForState(p, "awaiting_requirements_approval")).toBeNull();
  });

  it("assigns default graph node names when omitted", () => {
    const custom: PipelineConfig = {
      version: 1,
      lanes: [
        { id: "intake", label: "Intake", column: "intake", kind: "intake", actions: [] },
        {
          id: "review",
          label: "Review",
          column: "review",
          actions: [
            { type: "produce", artifact: "review" },
            { type: "fix" },
            { type: "human_approval" },
          ],
        },
        { id: "done", label: "Done", column: "done", kind: "terminal", actions: [] },
      ],
    };
    const p = resolvePipeline(custom);
    expect(p.laneById.get("review")?.actions.map((a) => a.graphNode)).toEqual([
      "review_draft",
      "review_fix",
      "review_gate",
    ]);
    expect(p.laneById.get("review")?.actions[2]?.awaitingState).toBe("awaiting_review_approval");
    expect(p.laneById.get("review")?.actions[2]?.gate).toBe("review");
  });
});

describe("pipeline helpers", () => {
  const p = resolvePipeline(DEFAULT_PIPELINE);

  it("walks nextAction across a lane and into the next lane", () => {
    expect(nextAction(p, "triage_draft")?.graphNode).toBe("requirements_draft");
    expect(nextAction(p, "requirements_draft")?.graphNode).toBe("requirements_gate");
    expect(nextAction(p, "requirements_gate")?.graphNode).toBe("tech_spec_draft");
    expect(nextAction(p, "review_gate")?.graphNode).toBe("pull_request");
    expect(nextAction(p, "pr_gate")?.type).toBe("publish");
    expect(nextAction(p, "missing")).toBeUndefined();
  });

  it("lists restart steps and artifact/doc clears from every step", () => {
    expect(p.restartSteps.map((s) => s.id)).toEqual([
      "intake",
      "triage",
      "planning",
      "tech_spec",
      "tasks",
      "implementation",
      "review",
      "pull_request",
    ]);
    expect(artifactsFromStep(p, "intake")).toEqual([
      "triage",
      "fr",
      "tech_spec",
      "task_graph",
      "review",
      "pr",
      "context",
    ]);
    expect(artifactsFromStep(p, "implementation")).toEqual(["review", "pr", "context"]);
    expect(artifactsFromStep(p, "review")).toEqual(["review", "pr", "context"]);
    expect(docsFromStep(p, "tasks")).toEqual(["tasks.json", "review.md", "review.json", "pull-request.md"]);
    expect(docsFromStep(p, "unknown-step")).toEqual(docsFromStep(p, "intake"));
  });

  it("computes stepIndex from lane ids and restart aliases", () => {
    expect(stepIndex(p, "intake")).toBe(0);
    expect(stepIndex(p, "inbox")).toBe(0);
    expect(stepIndex(p, "planning")).toBe(2);
    expect(stepIndex(p, "requirements")).toBe(2);
    expect(stepIndex(p, "review")).toBeGreaterThan(stepIndex(p, "implementation"));
    expect(stepIndex(p, "not-a-lane")).toBe(-1);
  });

  it("classifies runnable vs parked vs terminal states", () => {
    for (const s of ["triage", "requirements", "tech_spec", "tasks", "implementation", "review", "pull_request"]) {
      expect(isRunnableLaneState(p, s)).toBe(true);
    }
    for (const s of [
      "intake",
      "inbox",
      "done",
      "failed",
      "rejected",
      "paused",
      "awaiting_requirements_approval",
      "awaiting_tech_spec_approval",
      "awaiting_review_approval",
      "awaiting_pr_approval",
    ]) {
      expect(isRunnableLaneState(p, s)).toBe(false);
    }
  });

  it("approves, rejects, and sends back from every default gate", () => {
    expect(nextStateForApprove(p, "awaiting_requirements_approval", "approve")).toBe("tech_spec");
    expect(nextStateForApprove(p, "awaiting_tech_spec_approval", "approve")).toBe("tasks");
    expect(nextStateForApprove(p, "awaiting_tasks_approval", "approve")).toBe("implementation");
    expect(nextStateForApprove(p, "awaiting_review_approval", "approve")).toBe("pull_request");
    expect(nextStateForApprove(p, "awaiting_pr_approval", "approve")).toBe("done");
    expect(nextStateForApprove(p, "awaiting_requirements_approval", "reject")).toBe("rejected");
    expect(nextStateForApprove(p, "awaiting_review_approval", "send_back")).toBe("implementation");
    expect(nextStateForApprove(p, "awaiting_pr_approval", "send_back")).toBe("implementation");
  });

  it("places failed/paused/rejected cards on the last active column", () => {
    expect(columnForState(p, "failed", "implementation", "implementation")).toBe("implementation");
    expect(columnForState(p, "paused", "tech_spec", "tech_spec")).toBe("tech_spec");
    expect(columnForState(p, "rejected", "review", "review")).toBe("pull_request");
    expect(columnForState(p, "failed", "requirements", "requirements")).toBe("planning");
    expect(columnForState(p, "triage", "intake", "intake")).toBe("triage");
    expect(columnForState(p, "awaiting_requirements_approval", "requirements", "planning")).toBe("planning");
    expect(columnForState(p, "mystery", "x", "")).toBe("intake");
  });

  it("maps every awaiting_* slug including pr → pull_request", () => {
    expect(laneForJobState(p, "awaiting_tech_spec_approval")?.id).toBe("tech_spec");
    expect(laneForJobState(p, "awaiting_tasks_approval")?.id).toBe("tasks");
    expect(laneForJobState(p, "awaiting_pr_approval")?.id).toBe("pull_request");
    expect(graphNodeForState(p, "awaiting_requirements_approval")).toBe("requirements_gate");
    expect(graphNodeForState(p, "failed")).toBeUndefined();
    expect(graphNodeForState(p, "paused")).toBeUndefined();
    expect(laneByKey(p, "planning")?.id).toBe("requirements");
    expect(firstActionOf(p, "implementation")?.type).toBe("implement");
    expect(firstActionOf(p, "missing")).toBeUndefined();
  });

  it("hides review from the board but still restarts from it", () => {
    expect(p.columns.some((c) => c.id === "review")).toBe(false);
    expect(p.restartSteps.some((s) => s.id === "review")).toBe(true);
    expect(p.lanes.find((l) => l.id === "implementation")?.queue).toBe("impl");
    expect(p.lanes.find((l) => l.id === "triage")?.queue).toBe("planning");
    expect(p.firstAgentNode).toBe("triage_draft");
  });

  it("exposes columns and restart steps on publicPipeline", () => {
    const pub = publicPipeline(p);
    expect(pub.version).toBe(1);
    expect(pub.lanes).toEqual(DEFAULT_PIPELINE.lanes);
    expect(pub.columns.map((c) => c.id)).toEqual(p.columns.map((c) => c.id));
    expect(pub.restartSteps.map((s) => s.id)).toEqual(p.restartSteps.map((s) => s.id));
  });

  it("falls back to a readable name for unknown lanes", () => {
    expect(displayLaneName(p, "custom_lane")).toBe("custom lane");
  });
});
