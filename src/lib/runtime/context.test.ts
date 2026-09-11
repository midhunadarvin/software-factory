import { describe, expect, it } from "vitest";
import { contextFromFr, formatContextBlock, LaneContextSchema } from "./context";

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
});
