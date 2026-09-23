import fs from "node:fs";
import path from "node:path";
import {
  TriageReportSchema,
  type ArtifactKind,
} from "../../artifacts/schemas";
import {
  coerceFunctionalRequirements,
  coercePullRequestDraft,
  coerceReviewReport,
  coerceTaskGraph,
  coerceTechnicalSpec,
} from "../../artifacts/coerce";

export function artifactFileName(kind: ArtifactKind): string {
  return `${kind}.json`;
}

export function artifactFilePath(worktree: string, issueNumber: number, kind: ArtifactKind): string {
  return path.join(worktree, ".factory", "issues", String(Math.abs(issueNumber)), artifactFileName(kind));
}

export function readArtifactFile(worktree: string, issueNumber: number, kind: ArtifactKind): unknown | null {
  const file = artifactFilePath(worktree, issueNumber, kind);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeArtifactFile(
  worktree: string,
  issueNumber: number,
  kind: ArtifactKind,
  body: unknown,
): string {
  const file = artifactFilePath(worktree, issueNumber, kind);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body, null, 2));
  return file;
}

export function coerceHarnessArtifact(kind: ArtifactKind, raw: unknown): unknown {
  if (kind === "fr") return coerceFunctionalRequirements(raw);
  if (kind === "tech_spec") return coerceTechnicalSpec(raw);
  if (kind === "task_graph") return coerceTaskGraph(raw);
  if (kind === "review") return coerceReviewReport(raw);
  if (kind === "pr") return coercePullRequestDraft(raw);
  if (kind === "triage") return TriageReportSchema.parse(raw);
  return raw;
}
