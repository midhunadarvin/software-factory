import { describe, expect, it } from "vitest";
import {
  contextFromFr,
  contextFromReview,
  contextFromSpec,
  contextFromTasks,
  contextFromTriage,
  formatContextBlock,
  LaneContextSchema,
} from "./context";

describe("lane context", () => {
  it("builds a handoff from FR", () => {
    const ctx = contextFromFr({
      version: 1,
      summary: "Add healthcheck",
      actors: ["ops"],
      requirements: [
        {
          id: "FR-1",
          statement: "Expose GET /health",
          priority: "must",
          acceptance: ["returns 200"],
        },
      ],
      outOfScope: ["metrics"],
      openQuestions: [],
      visualPlan: {
        version: 1,
        title: "t",
        outline: [{ id: "n1", title: "a", children: [] }],
        mermaid: "flowchart LR\n A --> B",
      },
    });
    expect(LaneContextSchema.parse(ctx).fromLane).toBe("requirements");
    expect(formatContextBlock(ctx)).toContain("FR-1");
    expect(formatContextBlock(null)).toMatch(/first lane/i);
  });

  it("builds handoffs from triage, spec, tasks, and review", () => {
    const triage = contextFromTriage({
      version: 1,
      classification: "simple",
      risk: "low",
      rationale: "tiny change",
      affectedAreas: ["src/health.ts"],
      fastTrack: true,
    });
    expect(triage.summary).toMatch(/fast-track/);
    expect(triage.bullets.some((b) => b.includes("src/health.ts"))).toBe(true);

    const spec = contextFromSpec({
      version: 1,
      summary: "Add a route",
      stack: [{ name: "ts", reason: "repo" }],
      modules: [{ name: "api", path: "src/api.ts", responsibility: "handler", interfaces: [] }],
      dataChanges: [],
      apiChanges: [],
      risks: [],
      testing: ["curl"],
      visualPlan: { version: 1, title: "t", outline: [{ id: "n1", title: "a", children: [] }], mermaid: "flowchart LR\n A" },
    });
    expect(spec.fromLane).toBe("tech_spec");
    expect(spec.bullets[0]).toMatch(/src\/api.ts/);

    const tasks = contextFromTasks({
      version: 1,
      tasks: [
        { id: "T-1", title: "write", files: ["a.ts"], dependsOn: [], acceptance: ["ok"], status: "pending" },
      ],
    });
    expect(tasks.summary).toBe("1 tasks in the graph");
    expect(tasks.bullets[0]).toMatch(/T-1/);

    const review = contextFromReview({
      version: 1,
      summary: "looks good",
      verdict: "approve",
      findings: [{ id: "F-1", file: "a.ts", severity: "info", title: "nit", body: "n" }],
      filesChanged: ["a.ts"],
      computedDiffs: [],
    });
    expect(review.bullets[0]).toMatch(/approve/);
    expect(formatContextBlock(review)).toContain("Previous lane: review");
  });
});
