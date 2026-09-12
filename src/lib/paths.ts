import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Repo / data root. Re-read from env so a restart with the same FACTORY_ROOT keeps `var/`. */
export function factoryRoot(): string {
  return path.resolve(process.env.FACTORY_ROOT ?? MODULE_ROOT);
}

/** Snapshot at import time. Prefer `factoryRoot()` when the env may change. */
export const FACTORY_ROOT = factoryRoot();

export function varDir(): string {
  const dir = path.join(factoryRoot(), "var");
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

export function sessionsDir(): string {
  const dir = path.join(varDir(), "sessions");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sessionFilePath(jobId: string): string {
  return path.join(sessionsDir(), `${jobId}.json`);
}

export function invokePayloadPath(jobId: string): string {
  const dir = path.join(varDir(), "invokes");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${jobId}.json`);
}

export function worktreePath(projectId: string, jobId: string): string {
  return path.join(varDir(), "worktrees", projectId, jobId);
}

export function reposDir(): string {
  return process.env.FACTORY_REPOS_DIR
    ? path.resolve(process.env.FACTORY_REPOS_DIR)
    : path.join(os.homedir(), "software-factory", "repos");
}

export function defaultCloneDest(owner: string, repo: string): string {
  return path.join(reposDir(), owner, repo);
}

export function isInsideVar(absPath: string): boolean {
  const root = path.resolve(varDir());
  const target = path.resolve(absPath);
  return target === root || target.startsWith(root + path.sep);
}

export function nowIso(): string {
  return new Date().toISOString();
}
