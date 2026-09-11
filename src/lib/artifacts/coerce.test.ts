import { describe, expect, it } from "vitest";
import {
  coerceFunctionalRequirements,
  coercePullRequestDraft,
  coerceReviewReport,
  coerceTaskGraph,
  coerceTechnicalSpec,
} from "./coerce";

const addSpec = {
  version: 1,
  summary: "Fix add(a,b) in test.js to return a + b instead of hardcoded 3.",
  actors: ["Developer"],
  requirements: [
    {
      id: "FR-1",
      statement: "add(a, b) returns a + b.",
      priority: "must",
      acceptance: ["add(1, 2) === 3", "add(0, 0) === 0"],
    },
  ],
  outOfScope: [],
  openQuestions: [],
  visualPlan: {
    version: 1,
    title: "Fix add()",
    outline: [{ id: "n1", title: "Replace return 3 with return a + b", children: [] }],
    mermaid: "flowchart TD\n  A[Edit test.js] --> B[Verify]",
  },
};

describe("coerceTechnicalSpec", () => {
  it("fills missing modules, testing, and visualPlan", () => {
    const spec = coerceTechnicalSpec({ summary: "Fix add() in test.js" });
    expect(spec.modules.length).toBeGreaterThan(0);
    expect(spec.testing.length).toBeGreaterThan(0);
    expect(spec.visualPlan.mermaid).toMatch(/flowchart/);
  });

  it("keeps provided modules", () => {
    const spec = coerceTechnicalSpec({
      summary: "Fix add",
      modules: [{ name: "math", path: "test.js", responsibility: "add numbers" }],
      testing: ["node -e \"require('./test.js')\""],
    });
    expect(spec.modules[0]?.path).toBe("test.js");
  });
});

describe("coerceFunctionalRequirements", () => {
  it("accepts the spec the planning agent actually sends", () => {
    expect(coerceFunctionalRequirements(addSpec).actors).toEqual(["Developer"]);
    expect(coerceFunctionalRequirements(JSON.stringify(addSpec)).requirements[0]?.id).toBe("FR-1");
    expect(coerceFunctionalRequirements({ artifact: addSpec }).summary).toMatch(/Fix add/);
    expect(coerceFunctionalRequirements({ artifact: JSON.stringify(addSpec) }).requirements[0]?.statement).toMatch(
      /a \+ b/,
    );
  });

  it("keeps FR text when outline children are titles instead of ids", () => {
    const fr = coerceFunctionalRequirements({
      ...addSpec,
      visualPlan: {
        version: 1,
        title: "Fix add()",
        outline: [
          { id: "n1", title: "Edit", children: ["Verify with sample calls"] },
          { id: "n1", title: "Verify", children: [] },
        ],
        mermaid: "flowchart TD\n  A-->B",
      },
    });
    expect(fr.requirements[0]?.id).toBe("FR-1");
    expect(fr.visualPlan.outline.map((n) => n.id)).toEqual(["n1", "n1_2"]);
    expect(fr.visualPlan.outline[0]?.children).toEqual([]);
  });

  it("keeps Gherkin-style acceptance objects", () => {
    const fr = coerceFunctionalRequirements({
      summary: "Fix add",
      actors: ["Developer"],
      requirements: [
        {
          id: "FR-1",
          statement: "add returns a + b",
          priority: "must",
          acceptance: [{ given: "add is called", when: "with 1 and 2", then: "it returns 3" }],
        },
      ],
    });
    expect(fr.requirements[0]?.acceptance).toEqual(["it returns 3"]);
  });

  it("always returns a spec, even for empty input", () => {
    expect(coerceFunctionalRequirements(undefined).requirements[0]?.id).toBe("FR-1");
    expect(coerceFunctionalRequirements({}).summary.length).toBeGreaterThan(0);
  });
});

describe("coerceTaskGraph", () => {
  it("accepts the top-level tasks payload the agent sends", () => {
    const graph = coerceTaskGraph({
      version: 1,
      tasks: [
        {
          id: "T-1",
          title: "Replace return 3 with return a + b",
          files: ["test.js"],
          dependsOn: [],
          acceptance: ["add(2, 3) === 5"],
        },
        {
          id: "T-2",
          title: "Verify acceptance cases",
          files: ["test.js"],
          dependsOn: ["T-1"],
          acceptance: ["add(-1, 1) === 0"],
        },
      ],
    });
    expect(graph.tasks.map((t) => t.id)).toEqual(["T-1", "T-2"]);
    expect(graph.tasks[1]?.dependsOn).toEqual(["T-1"]);
  });

  it("unwraps { artifact } and JSON strings, and repairs cycles", () => {
    const raw = {
      tasks: [
        { id: "T-1", title: "a", dependsOn: ["T-2"], acceptance: ["x"] },
        { id: "T-2", title: "b", dependsOn: ["T-1"], acceptance: ["x"] },
      ],
    };
    expect(coerceTaskGraph({ artifact: raw }).tasks).toHaveLength(2);
    expect(coerceTaskGraph(JSON.stringify(raw)).tasks[0]?.id).toBe("T-1");
    const cyclic = coerceTaskGraph(raw);
    const parsed = cyclic.tasks.every((t) => t.dependsOn.every((d) => d !== t.id));
    expect(parsed).toBe(true);
  });

  it("always returns a graph", () => {
    expect(coerceTaskGraph(undefined).tasks[0]?.id).toBe("T-1");
  });
});

describe("coerceReviewReport", () => {
  it("accepts the top-level report the review agent sends", () => {
    const report = coerceReviewReport({
      version: 1,
      summary: "add() now returns a + b.",
      verdict: "approve",
      findings: [],
      filesChanged: ["test.js"],
    });
    expect(report.verdict).toBe("approve");
    expect(report.filesChanged).toEqual(["test.js"]);
  });

  it("still works when wrapped or sent as JSON", () => {
    const raw = { summary: "ok", verdict: "approve", findings: [], filesChanged: ["test.js"] };
    expect(coerceReviewReport({ artifact: raw }).verdict).toBe("approve");
    expect(coerceReviewReport(JSON.stringify(raw)).filesChanged).toEqual(["test.js"]);
  });
});

describe("coercePullRequestDraft", () => {
  it("keeps an agent-written title and body", () => {
    const draft = coercePullRequestDraft({
      title: "fix: return a + b from add()",
      body: "## Summary\n\nadd() was hardcoded.\n\n## How to test\n\nnode -e \"...\"\n",
    });
    expect(draft.title).toMatch(/add/);
    expect(draft.body).toMatch(/How to test/);
  });
});

