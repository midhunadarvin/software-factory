import type {
  FunctionalRequirements,
  ReviewReport,
  TaskGraph,
  TechnicalSpec,
} from "../artifacts/schemas";

export function fixtureFr(title: string): FunctionalRequirements {
  return {
    version: 1,
    summary: `Implement: ${title}`,
    actors: ["operator", "factory"],
    requirements: [
      {
        id: "FR-1",
        statement: `Deliver the change described by "${title}".`,
        priority: "must",
        acceptance: ["Behavior matches the brief", "Existing tests still pass"],
      },
    ],
    outOfScope: ["Unrelated refactors"],
    openQuestions: [],
    visualPlan: {
      version: 1,
      title: title.slice(0, 200) || "Plan",
      outline: [{ id: "n1", title: "Change", children: [], notes: title }],
      mermaid: "flowchart LR\n  A[Brief] --> B[Change]",
    },
  };
}

export function fixtureSpec(title: string): TechnicalSpec {
  return {
    version: 1,
    summary: `Technical approach for ${title}`,
    stack: [{ name: "existing", reason: "match the attached repo" }],
    modules: [
      {
        name: "core",
        path: ".",
        responsibility: "Implement the requested change in place",
        interfaces: [],
      },
    ],
    dataChanges: [],
    apiChanges: [],
    risks: [{ risk: "scope creep", mitigation: "stay inside the task graph" }],
    testing: ["Run the repo test script if present"],
    visualPlan: {
      version: 1,
      title: "Tech spec",
      outline: [{ id: "m1", title: "core", children: [] }],
      mermaid: "flowchart LR\n  Spec --> Code",
    },
  };
}

export function fixtureTasks(): TaskGraph {
  return {
    version: 1,
    tasks: [
      {
        id: "T-1",
        title: "Implement the change",
        dependsOn: [],
        files: [],
        acceptance: ["Code matches the approved spec"],
        status: "pending",
      },
    ],
  };
}

export function fixtureReview(): ReviewReport {
  return {
    version: 1,
    summary: "Automated review placeholder.",
    verdict: "approve",
    findings: [],
    filesChanged: [],
    computedDiffs: [],
  };
}
