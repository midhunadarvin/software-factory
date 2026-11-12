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

function parseJsonFile(file: string): unknown | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function readArtifactFile(worktree: string, issueNumber: number, kind: ArtifactKind): unknown | null {
  const exact = parseJsonFile(artifactFilePath(worktree, issueNumber, kind));
  if (exact != null) return exact;
  const issuesDir = path.join(worktree, ".factory", "issues");
  if (!fs.existsSync(issuesDir)) return null;
  for (const name of fs.readdirSync(issuesDir)) {
    const found = parseJsonFile(path.join(issuesDir, name, artifactFileName(kind)));
    if (found != null) return found;
  }
  return null;
}

export function parseArtifactFromText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
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

export function inferTriageFromText(text: string): unknown | null {
  const classMatch =
    text.match(/\*\*(simple|complex)\*\*/i) ??
    text.match(/\bclassification\b[:\s*]*\b(simple|complex)\b/i) ??
    text.match(/\b(simple|complex)\b/i);
  const riskMatch =
    text.match(/\*\*(low|medium|high)\s+risk\*\*/i) ??
    text.match(/\b(low|medium|high)\s+risk\b/i) ??
    text.match(/\brisk\b[:\s*]*\b(low|medium|high)\b/i);
  if (!classMatch || !riskMatch) return null;
  const classification = classMatch[1]!.toLowerCase();
  const risk = (riskMatch[1] ?? riskMatch[0]).toLowerCase().replace(/\s+risk$/, "");
  const parsed = TriageReportSchema.safeParse({
    version: 1,
    classification,
    risk: risk === "low" || risk === "medium" || risk === "high" ? risk : "medium",
    rationale: text.trim().slice(0, 4000) || "CLI triage without JSON file",
    affectedAreas: [],
    fastTrack: false,
  });
  return parsed.success ? parsed.data : null;
}
