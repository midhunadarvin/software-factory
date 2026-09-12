import { describe, expect, it } from "vitest";
import { nextPending, nextStageAfterTask, pathHit, resetFlaggedTasks } from "./reset-flagged";
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

  it("resets failed tasks even without a matching finding", () => {
    const next = resetFlaggedTasks(
      {
        version: 1,
        tasks: [
          { id: "T-1", title: "a", files: ["x.ts"], dependsOn: [], acceptance: ["ok"], status: "failed" },
          { id: "T-2", title: "b", files: ["y.ts"], dependsOn: ["T-1"], acceptance: ["ok"], status: "pending" },
        ],
      },
      {
        version: 1,
        summary: "n",
        verdict: "request_changes",
        findings: [],
        filesChanged: [],
        computedDiffs: [],
      },
    );
    expect(next.tasks[0]?.status).toBe("pending");
  });

  it("reopens the last task when every task is done and nothing was flagged", () => {
    const next = resetFlaggedTasks(
      {
        version: 1,
        tasks: [
          { id: "T-1", title: "a", files: ["a.ts"], dependsOn: [], acceptance: ["ok"], status: "done" },
          { id: "T-2", title: "b", files: ["b.ts"], dependsOn: ["T-1"], acceptance: ["ok"], status: "done" },
        ],
      },
      {
        version: 1,
        summary: "n",
        verdict: "request_changes",
        findings: [{ id: "F-1", file: "other.ts", severity: "info", title: "n", body: "n" }],
        filesChanged: [],
        computedDiffs: [],
      },
    );
    expect(next.tasks.map((t) => t.status)).toEqual(["done", "pending"]);
  });

  it("returns review_draft only when nothing is pending", () => {
    expect(
      nextStageAfterTask({
        version: 1,
        tasks: [{ id: "T-1", title: "a", files: [], dependsOn: [], acceptance: ["ok"], status: "done" }],
      }),
    ).toBe("review_draft");
    expect(
      nextStageAfterTask({
        version: 1,
        tasks: [{ id: "T-1", title: "a", files: [], dependsOn: [], acceptance: ["ok"], status: "pending" }],
      }),
    ).toBe("implementation");
  });

  it("leaves implementation when a later task is still pending", () => {
    const pending = {
      ...graph,
      tasks: graph.tasks.map((t) => (t.id === "T-2" ? { ...t, status: "pending" as const } : t)),
    };
    expect(nextStageAfterTask(pending)).toBe("implementation");
    expect(nextStageAfterTask(graph)).toBe("review_draft");
  });
});
