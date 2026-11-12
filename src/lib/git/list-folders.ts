import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SKIP = new Set([".git", "node_modules", ".Trash"]);
const MAX = 400;

export type FolderEntry = {
  name: string;
  path: string;
  git: boolean;
};

export type FolderList = {
  dir: string;
  parent: string | null;
  git: boolean;
  entries: FolderEntry[];
  error?: string;
};

export function expandUserPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function resolveExistingDir(raw?: string): string {
  const start = raw?.trim() ? path.resolve(expandUserPath(raw)) : os.homedir();
  let cur = start;
  for (let i = 0; i < 32; i++) {
    try {
      if (fs.statSync(cur).isDirectory()) return cur;
    } catch {
      // walk up from a missing path
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return os.homedir();
}

function isGitDir(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, ".git"));
  } catch {
    return false;
  }
}

export function listFolders(raw?: string): FolderList {
  const dir = resolveExistingDir(raw);
  const parent = path.dirname(dir) === dir ? null : path.dirname(dir);
  try {
    const names = fs.readdirSync(dir);
    const entries: FolderEntry[] = [];
    for (const name of names) {
      if (SKIP.has(name)) continue;
      const full = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      entries.push({ name, path: full, git: isGitDir(full) });
      if (entries.length >= MAX) break;
    }
    entries.sort((a, b) => {
      if (a.git !== b.git) return a.git ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { dir, parent, git: isGitDir(dir), entries };
  } catch (err) {
    return {
      dir,
      parent,
      git: false,
      entries: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
