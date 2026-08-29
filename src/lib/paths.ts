import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const FACTORY_ROOT = path.resolve(
  process.env.FACTORY_ROOT ?? path.resolve(process.cwd()),
);

export function varDir(): string {
  const dir = path.join(FACTORY_ROOT, "var");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function factorySqlitePath(): string {
  return path.join(varDir(), "factory.sqlite");
}

export function checkpointsSqlitePath(): string {
  return path.join(varDir(), "checkpoints.sqlite");
}

export function runtimeLockPath(): string {
  return path.join(varDir(), "factory.runtime.lock");
}

export function worktreePath(projectId: string, jobId: string): string {
  return path.join(varDir(), "worktrees", projectId, jobId);
}

export function defaultCloneDest(owner: string, repo: string): string {
  return path.join(os.homedir(), "software-factory", "repos", owner, repo);
}

export function isInsideVar(absPath: string): boolean {
  const root = path.resolve(varDir());
  const target = path.resolve(absPath);
  return target === root || target.startsWith(root + path.sep);
}

export function nowIso(): string {
  return new Date().toISOString();
}
