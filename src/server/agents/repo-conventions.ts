import fs from "node:fs";
import path from "node:path";

export const CONVENTION_CANDIDATES = ["AGENTS.md", ".factory/AGENTS.md", "CONTRIBUTING.md"] as const;

export const CONVENTION_MAX_CHARS = 12_000;

export function loadRepoConventions(
  worktree: string,
): { path: (typeof CONVENTION_CANDIDATES)[number]; body: string } | null {
  for (const rel of CONVENTION_CANDIDATES) {
    const abs = path.join(worktree, rel);
    try {
      if (!fs.statSync(abs).isFile()) continue;
      const raw = fs.readFileSync(abs, "utf8");
      if (!raw.trim()) continue;
      const body = raw.length > CONVENTION_MAX_CHARS ? `${raw.slice(0, CONVENTION_MAX_CHARS)}\n…` : raw;
      return { path: rel, body };
    } catch {
      /* missing */
    }
  }
  return null;
}

export function formatRepoConventions(worktree: string | null | undefined): string {
  if (!worktree) return "";
  const loaded = loadRepoConventions(worktree);
  if (!loaded) return "";
  return [
    "",
    `## Repo conventions (authoritative for this worktree, from ${loaded.path})`,
    loaded.body,
    "Follow these over generic lane instructions when they conflict. Do not invent a parallel stack or folder.",
    "",
  ].join("\n");
}
