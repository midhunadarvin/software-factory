import path from "node:path";
import type { ReviewReport, TaskGraph } from "./schemas";

export function normPath(p: string): string {
  return path.posix
    .normalize(p.replace(/\\/g, "/"))
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

export function pathHit(findingFile: string, taskFile: string): boolean {
  const f = normPath(findingFile);
  const t = normPath(taskFile);
  return f === t || f.startsWith(t + "/") || t.startsWith(f + "/");
}

export function resetFlaggedTasks(graph: TaskGraph, report: ReviewReport): TaskGraph {
  const flagged = report.findings
    .filter((x) => x.severity === "blocker" || x.severity === "major")
    .map((x) => x.file);
  const next: TaskGraph = {
    version: 1,
    tasks: graph.tasks.map((t) => {
      const hit =
        t.status === "failed" ||
        t.files.some((tf) => flagged.some((ff) => pathHit(ff, tf)));
      return hit ? { ...t, status: "pending" as const } : t;
    }),
  };
  if (next.tasks.every((t) => t.status === "done")) {
    const last = next.tasks[next.tasks.length - 1];
    if (last) last.status = "pending";
  }
  return next;
}

export function nextPending(graph: TaskGraph) {
  const byId = new Map(graph.tasks.map((t) => [t.id, t]));
  return (
    graph.tasks.find((t) => {
      if (t.status !== "pending") return false;
      return t.dependsOn.every((d) => byId.get(d)?.status === "done");
    }) ?? null
  );
}
