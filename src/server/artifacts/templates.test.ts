import { describe, expect, it } from "vitest";
import { frMarkdown, frMdx, prMarkdown, reviewMarkdown, specMarkdown, specMdx, tasksMarkdown } from "./templates";
import type { FunctionalRequirements, ReviewReport, TaskGraph, TechnicalSpec } from "./schemas";

const visual = {
  version: 1 as const,
  title: "plan",
  outline: [{ id: "n1", title: "step", children: [] }],
  mermaid: "flowchart TD\n  A-->B",
};

const fr: FunctionalRequirements = {
  version: 1,
  summary: "Add healthcheck",
  actors: ["ops"],
  requirements: [
    { id: "FR-1", statement: "GET /health returns 200", priority: "must", acceptance: ["curl is 200"] },
  ],
  outOfScope: ["metrics"],
  openQuestions: ["auth?"],
  visualPlan: visual,
};

const spec: TechnicalSpec = {
  version: 1,
  summary: "Route in Next",
  stack: [{ name: "TypeScript", reason: "repo" }],
  modules: [{ name: "health", path: "src/app/api/health/route.ts", responsibility: "probe", interfaces: [] }],
  dataChanges: [],
  apiChanges: ["GET /health"],
  risks: [{ risk: "none", mitigation: "n/a" }],
  testing: ["curl"],
  visualPlan: visual,
};

describe("artifact templates", () => {
  it("renders FR markdown and mdx", () => {
    expect(frMarkdown(fr)).toContain("FR-1");
    expect(frMarkdown(fr)).toContain("ops");
    expect(frMarkdown(fr)).toContain("flowchart TD");
    expect(frMdx(fr)).toContain("Add healthcheck");
  });

  it("renders spec markdown and mdx", () => {
    expect(specMarkdown(spec)).toMatch(/TypeScript/);
    expect(specMdx(spec)).toContain("src/app/api/health/route.ts");
  });

  it("renders tasks, review, and PR documents", () => {
    const tasks: TaskGraph = {
      version: 1,
      tasks: [
        { id: "T-1", title: "add route", files: ["src/x.ts"], dependsOn: [], acceptance: ["200"], status: "pending" },
      ],
    };
    expect(tasksMarkdown(tasks)).toContain("T-1");
    const review: ReviewReport = {
      version: 1,
      summary: "ok",
      verdict: "approve",
      findings: [{ id: "F-1", file: "src/x.ts", severity: "info", title: "nit", body: "style" }],
      filesChanged: ["src/x.ts"],
      computedDiffs: [],
    };
    expect(reviewMarkdown(review)).toContain("approve");
    expect(reviewMarkdown(review)).toContain("nit");
    expect(prMarkdown("feat: health", "## Summary\nprobe")).toContain("feat: health");
    expect(prMarkdown("feat: health", "## Summary\nprobe")).toContain("probe");
  });
});
