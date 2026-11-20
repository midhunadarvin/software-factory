import {
  FunctionalRequirementsSchema,
  TechnicalSpecSchema,
  TaskGraphSchema,
  VisualPlanSchema,
  PullRequestDraftSchema,
  ReviewReportSchema,
  type FunctionalRequirements,
  type TechnicalSpec,
  type TaskGraph,
  type VisualPlan,
  type PullRequestDraft,
  type ReviewReport,
} from "./schemas";

export function defaultVisualPlan(title: string): VisualPlan {
  const safe = title.replace(/[[\]{}()]/g, "").slice(0, 80) || "change";
  return {
    version: 1,
    title: title.slice(0, 200) || "Change",
    outline: [{ id: "n1", title: title.slice(0, 200) || "Change", children: [] }],
    mermaid: `flowchart TD\n  A[${safe}] --> B[Implement]\n  B --> C[Verify]`,
  };
}

export function defaultFunctionalRequirements(summary?: string): FunctionalRequirements {
  const text = (summary || "Planning spec for the requested change.").slice(0, 4000);
  return {
    version: 1,
    summary: text,
    actors: ["developer"],
    requirements: [
      {
        id: "FR-1",
        statement: "Implement the requested change.",
        priority: "must",
        acceptance: ["change is implemented and verified"],
      },
    ],
    outOfScope: [],
    openQuestions: [],
    visualPlan: defaultVisualPlan(text),
  };
}

export function coerceTechnicalSpec(raw: unknown): TechnicalSpec {
  const o = asRecord(unwrapArtifact(raw));
  if (!o) return coerceTechnicalSpec({ summary: typeof raw === "string" ? raw : "Technical spec." });
  const summary = str(o.summary) || "Technical spec for the requested change.";
  const modulesIn = Array.isArray(o.modules) ? o.modules : [];
  const modules = modulesIn
    .map((m) => {
      const r = asRecord(m);
      if (!r) return null;
      return {
        name: str(r.name) || str(r.path) || "module",
        path: str(r.path) || ".",
        responsibility: str(r.responsibility) || summary,
        interfaces: strArr(r.interfaces),
      };
    })
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (!modules.length) {
    modules.push({ name: "app", path: ".", responsibility: summary, interfaces: [] });
  }
  const draft = {
    version: 1 as const,
    summary: summary.slice(0, 4000),
    stack: Array.isArray(o.stack)
      ? o.stack
          .map((s) => {
            const r = asRecord(s);
            return r ? { name: str(r.name) || "stack", reason: str(r.reason) || "in repo" } : null;
          })
          .filter((s): s is { name: string; reason: string } => Boolean(s))
      : [{ name: "existing repo", reason: "stay inside the attached tree" }],
    modules,
    dataChanges: strArr(o.dataChanges),
    apiChanges: strArr(o.apiChanges),
    risks: Array.isArray(o.risks)
      ? o.risks
          .map((s) => {
            const r = asRecord(s);
            return r ? { risk: str(r.risk) || "risk", mitigation: str(r.mitigation) || "review" } : null;
          })
          .filter((s): s is { risk: string; mitigation: string } => Boolean(s))
      : [],
    testing: strArr(o.testing).length ? strArr(o.testing) : ["manual verification of the change"],
    visualPlan: coerceVisualPlan(o.visualPlan, summary),
  };
  const parsed = TechnicalSpecSchema.safeParse(draft);
  return parsed.success
    ? parsed.data
    : TechnicalSpecSchema.parse({
        ...draft,
        visualPlan: defaultVisualPlan(summary),
      });
}

/** Pull a spec out of a JSON string, `{ artifact }`, or the tool's top-level fields. */
export function unwrapArtifact(raw: unknown): unknown {
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return raw;
    try {
      return unwrapArtifact(JSON.parse(t));
    } catch {
      return { summary: t };
    }
  }
  const o = asRecord(raw);
  if (!o) return raw;
  if (!("artifact" in o) || o.artifact === undefined || o.artifact === null) return o;
  const inner = o.artifact;
  if (typeof inner === "string") {
    const t = inner.trim();
    try {
      return unwrapArtifact(JSON.parse(t));
    } catch {
      if (looksLikeSpec(o)) {
        const { artifact: _drop, ...rest } = o;
        return rest;
      }
      return { summary: t };
    }
  }
  if (asRecord(inner)) return unwrapArtifact(inner);
  if (looksLikeSpec(o)) {
    const { artifact: _drop, ...rest } = o;
    return rest;
  }
  return inner;
}

export function coerceFunctionalRequirements(raw: unknown): FunctionalRequirements {
  const o = asRecord(unwrapArtifact(raw));
  if (!o) {
    return defaultFunctionalRequirements(typeof raw === "string" ? raw.trim() : undefined);
  }
  const summary = str(o.summary) || "Functional requirements for the requested change.";
  const reqs = Array.isArray(o.requirements)
    ? o.requirements
        .map((r, i) => {
          const rec = asRecord(r);
          if (!rec) return null;
          const id = /^FR-\d+$/.test(str(rec.id)) ? str(rec.id) : `FR-${i + 1}`;
          const acceptance = strArr(rec.acceptance);
          return {
            id,
            statement: str(rec.statement) || str(rec.title) || str(rec.description) || summary,
            priority: rec.priority === "should" || rec.priority === "could" ? rec.priority : "must",
            acceptance: acceptance.length ? acceptance : ["behavior matches the statement"],
          };
        })
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
    : [];
  if (!reqs.length) {
    reqs.push({
      id: "FR-1",
      statement: summary,
      priority: "must" as const,
      acceptance: ["change is implemented and verified"],
    });
  }
  const draft = {
    version: 1 as const,
    summary: summary.slice(0, 4000),
    actors: strArr(o.actors).length ? strArr(o.actors) : ["developer"],
    requirements: reqs,
    outOfScope: strArr(o.outOfScope),
    openQuestions: strArr(o.openQuestions),
    visualPlan: coerceVisualPlan(o.visualPlan, summary),
  };
  const parsed = FunctionalRequirementsSchema.safeParse(draft);
  return parsed.success ? parsed.data : defaultFunctionalRequirements(summary);
}

export function defaultTaskGraph(title = "Implement the change"): TaskGraph {
  return {
    version: 1,
    tasks: [
      {
        id: "T-1",
        title: title.slice(0, 200) || "Implement the change",
        dependsOn: [],
        files: [],
        acceptance: ["change is implemented"],
        status: "pending",
      },
    ],
  };
}

export function defaultPullRequestDraft(title = "Factory change"): PullRequestDraft {
  const t = title.slice(0, 200) || "Factory change";
  return {
    version: 1,
    title: t,
    body: `## Summary\n\n${t}\n\n## Changes\n\n- See the branch diff.\n\n## How to test\n\n- Exercise the changed paths and confirm expected behavior.\n`,
  };
}

export function defaultReviewReport(summary = "Implementation matches the spec."): ReviewReport {
  return {
    version: 1,
    summary: summary.slice(0, 4000) || "Implementation matches the spec.",
    verdict: "approve",
    findings: [],
    filesChanged: [],
    computedDiffs: [],
  };
}

export function coerceReviewReport(raw: unknown): ReviewReport {
  const o = asRecord(unwrapArtifact(raw));
  if (!o) return defaultReviewReport(typeof raw === "string" ? raw.trim() : undefined);
  const verdict =
    o.verdict === "request_changes" || o.verdict === "changes_requested" ? "request_changes" : "approve";
  const findingsIn = Array.isArray(o.findings) ? o.findings : [];
  const findings = findingsIn
    .map((f, i) => {
      const rec = asRecord(f);
      if (!rec) return null;
      const severity =
        rec.severity === "blocker" || rec.severity === "major" || rec.severity === "minor" || rec.severity === "info"
          ? rec.severity
          : "info";
      return {
        id: str(rec.id) || `F-${i + 1}`,
        file: str(rec.file) || str(rec.path) || "(unknown)",
        startLine: typeof rec.startLine === "number" ? rec.startLine : undefined,
        endLine: typeof rec.endLine === "number" ? rec.endLine : undefined,
        severity,
        title: str(rec.title) || str(rec.summary) || "finding",
        body: str(rec.body) || str(rec.detail) || str(rec.title) || "see title",
        diff: str(rec.diff) || undefined,
      };
    })
    .filter((f): f is NonNullable<typeof f> => Boolean(f));
  const draft = {
    version: 1 as const,
    summary: (str(o.summary) || "Review of the implementation.").slice(0, 4000),
    verdict,
    findings,
    filesChanged: strArr(o.filesChanged).slice(0, 400),
    computedDiffs: Array.isArray(o.computedDiffs)
      ? o.computedDiffs
          .map((d) => {
            const rec = asRecord(d);
            if (!rec) return null;
            const file = str(rec.file);
            const diff = str(rec.diff);
            return file && diff ? { file, diff: diff.slice(0, 50_000) } : null;
          })
          .filter((d): d is { file: string; diff: string } => Boolean(d))
      : [],
  };
  const parsed = ReviewReportSchema.safeParse(draft);
  return parsed.success ? parsed.data : defaultReviewReport(draft.summary);
}

export function coercePullRequestDraft(raw: unknown): PullRequestDraft {
  const o = asRecord(unwrapArtifact(raw));
  if (!o) return defaultPullRequestDraft(typeof raw === "string" ? raw.trim() : undefined);
  const title = (str(o.title) || str(o.summary) || "Factory change").slice(0, 200);
  const body = str(o.body) || str(o.description) || defaultPullRequestDraft(title).body;
  const parsed = PullRequestDraftSchema.safeParse({
    version: 1,
    title,
    body: body.slice(0, 20_000),
  });
  return parsed.success ? parsed.data : defaultPullRequestDraft(title);
}

export function coerceTaskGraph(raw: unknown): TaskGraph {
  const o = asRecord(unwrapArtifact(raw));
  if (!o) return defaultTaskGraph(typeof raw === "string" ? raw.trim() : undefined);
  const seen = new Set<string>();
  const tasks = (Array.isArray(o.tasks) ? o.tasks : [])
    .map((t, i) => {
      const rec = asRecord(t);
      if (!rec) return null;
      let id = /^T-\d+$/.test(str(rec.id)) ? str(rec.id) : `T-${i + 1}`;
      if (seen.has(id)) id = `T-${i + 1}`;
      while (seen.has(id)) id = `T-${seen.size + 1}`;
      seen.add(id);
      const acceptance = strArr(rec.acceptance);
      return {
        id,
        title: (str(rec.title) || str(rec.statement) || `Task ${id}`).slice(0, 200),
        dependsOn: strArr(rec.dependsOn),
        files: strArr(rec.files),
        acceptance: acceptance.length ? acceptance : ["task complete"],
        status: "pending" as const,
      };
    })
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  if (!tasks.length) return defaultTaskGraph(str(o.summary) || str(o.title));
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    t.dependsOn = t.dependsOn.filter((d) => ids.has(d) && d !== t.id);
  }
  dropTaskCycles(tasks);
  const parsed = TaskGraphSchema.safeParse({ version: 1, tasks: tasks.slice(0, 40) });
  return parsed.success ? parsed.data : defaultTaskGraph(str(o.summary));
}

function dropTaskCycles(tasks: { id: string; dependsOn: string[] }[]) {
  const vis = new Map<string, 0 | 1 | 2>();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dfs = (id: string): boolean => {
    const s = vis.get(id) ?? 0;
    if (s === 1) return true;
    if (s === 2) return false;
    vis.set(id, 1);
    const t = byId.get(id);
    if (t) {
      t.dependsOn = t.dependsOn.filter((d) => {
        if (dfs(d)) return false;
        return true;
      });
    }
    vis.set(id, 2);
    return false;
  };
  for (const t of tasks) dfs(t.id);
}

function coerceVisualPlan(raw: unknown, title: string): VisualPlan {
  const fallback = defaultVisualPlan(title);
  const o = asRecord(raw);
  if (!o) return fallback;
  const seen = new Set<string>();
  const outline = (Array.isArray(o.outline) ? o.outline : [])
    .map((n, i) => {
      const r = asRecord(n);
      if (!r) return null;
      let id = str(r.id) || `n${i + 1}`;
      if (seen.has(id)) id = `${id}_${i + 1}`;
      seen.add(id);
      return {
        id,
        title: str(r.title) || `step ${i + 1}`,
        children: strArr(r.children),
        notes: str(r.notes) || undefined,
      };
    })
    .filter((n): n is NonNullable<typeof n> => Boolean(n));
  const ids = new Set(outline.map((n) => n.id));
  for (const n of outline) {
    n.children = n.children.filter((c) => ids.has(c));
  }
  const plan = {
    version: 1 as const,
    title: (str(o.title) || title).slice(0, 200) || "Change",
    outline: outline.length ? outline : fallback.outline,
    mermaid: (str(o.mermaid) || fallback.mermaid).slice(0, 20_000),
  };
  const parsed = VisualPlanSchema.safeParse(plan);
  return parsed.success ? parsed.data : fallback;
}

function looksLikeSpec(o: Record<string, unknown>): boolean {
  return Boolean(
    o.summary || o.requirements || o.modules || o.visualPlan || o.actors || o.tasks || o.verdict || o.title,
  );
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (typeof x === "string") return x.trim();
      const r = asRecord(x);
      if (!r) return "";
      return str(r.then) || str(r.text) || str(r.statement) || str(r.title) || "";
    })
    .filter(Boolean);
}
