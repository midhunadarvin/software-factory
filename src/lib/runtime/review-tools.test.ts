import { describe, expect, it } from "vitest";
import {
  pickReviewArtifact,
  reviewArtifactInputSchema,
  reviewReportInputSchema,
  taskGraphInputSchema,
} from "./review-tools";

const addSpec = {
  version: 1,
  summary: "Fix add(a,b) in test.js to return a + b instead of hardcoded 3.",
  actors: ["Developer"],
  requirements: [
    {
      id: "FR-1",
      statement: "add(a, b) returns a + b.",
      priority: "must",
      acceptance: ["add(1, 2) === 3"],
    },
  ],
  outOfScope: [],
  openQuestions: [],
  visualPlan: {
    version: 1,
    title: "Fix add()",
    outline: [{ id: "n1", title: "Replace return 3", children: [] }],
    mermaid: "flowchart TD\n  A[Edit test.js] --> B[Verify]",
  },
};

describe("reviewArtifactInputSchema", () => {
  it("keeps top-level spec fields the model sends (not only artifact)", () => {
    const parsed = reviewArtifactInputSchema.parse(addSpec);
    expect(parsed.summary).toMatch(/Fix add/);
    expect(parsed.actors).toEqual(["Developer"]);
    expect(Array.isArray(parsed.requirements)).toBe(true);
    expect(parsed.visualPlan).toMatchObject({ title: "Fix add()" });
  });

  it("still accepts a wrapped artifact", () => {
    const parsed = reviewArtifactInputSchema.parse({ artifact: addSpec });
    expect(pickReviewArtifact(parsed)).toMatchObject({ artifact: addSpec });
  });
});

describe("reviewReportInputSchema", () => {
  it("keeps top-level review fields the model sends", () => {
    const parsed = reviewReportInputSchema.parse({
      version: 1,
      summary: "Looks good",
      verdict: "approve",
      findings: [],
      filesChanged: ["test.js"],
    });
    expect(parsed.verdict).toBe("approve");
    expect(parsed.filesChanged).toEqual(["test.js"]);
  });
});

describe("taskGraphInputSchema", () => {
  it("keeps a top-level tasks array", () => {
    const parsed = taskGraphInputSchema.parse({
      version: 1,
      tasks: [{ id: "T-1", title: "fix add", files: ["test.js"], dependsOn: [], acceptance: ["ok"] }],
    });
    expect(Array.isArray(parsed.tasks)).toBe(true);
    expect(parsed.tasks).toHaveLength(1);
  });
});
