import { describe, expect, it } from "vitest";
import { nextPending, pathHit, resetFlaggedTasks } from "./reset-flagged";
import type { ReviewReport, TaskGraph } from "./schemas";

const graph: TaskGraph = {
  version: 1,
  tasks: [
    {
      id: "T-1",
      title: "one",
      dependsOn: [],
      files: ["src/a.ts"],
      acceptance: ["ok"],
      status: "done",
    },
    {
      id: "T-2",
      title: "two",
      dependsOn: ["T-1"],
      files: ["src/foo/bar.ts"],
      acceptance: ["ok"],
      status: "done",
    },
  ],
};

describe("resetFlaggedTasks", () => {
  it("normalizes paths", () => {
    expect(pathHit("./src/a.ts", "src/a.ts")).toBe(true);
    expect(pathHit("src\\a.ts", "src/a.ts")).toBe(true);
    expect(pathHit("src/foo/", "src/foo/bar.ts")).toBe(true);
  });

  it("resets major findings", () => {
    const report: ReviewReport = {
      version: 1,
      summary: "x",
      verdict: "request_changes",
      findings: [
        {
          id: "1",
          file: "./src/a.ts",
          severity: "major",
          title: "bug",
          body: "fix",
        },
      ],
      filesChanged: [],
      computedDiffs: [],
    };
    const next = resetFlaggedTasks(graph, report);
    expect(next.tasks[0].status).toBe("pending");
    expect(next.tasks[1].status).toBe("done");
  });

  it("nextPending walks deps", () => {
    expect(nextPending(graph)?.id).toBeUndefined();
    const pending = {
      ...graph,
      tasks: graph.tasks.map((t) => (t.id === "T-2" ? { ...t, status: "pending" as const } : t)),
    };
    expect(nextPending(pending)?.id).toBe("T-2");
  });
});
