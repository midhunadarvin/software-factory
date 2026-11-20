import path from "node:path";

export function resolveInRoot(root: string, userPath: string): string {
  if (path.isAbsolute(userPath)) {
    throw new Error("absolute paths are not allowed");
  }
  if (userPath.split(/[/\\]/).includes("..")) {
    throw new Error("path traversal rejected");
  }
  const resolved = path.resolve(root, userPath);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error("path escapes sandbox");
  }
  return resolved;
}

export const EXEC_ALLOWLIST = new Set([
  "git",
  "node",
  "pnpm",
  "npm",
  "python3",
  "pytest",
  "tsc",
]);

export function assertExecAllowed(bin: string): void {
  const base = path.basename(bin);
  if (base === "npx") throw new Error("npx is not allowed");
  if (!EXEC_ALLOWLIST.has(base)) {
    throw new Error(`binary not allowlisted: ${base}`);
  }
}

export function longTimeout(cmd: string[]): boolean {
  const joined = cmd.join(" ");
  return /\b(pnpm|npm)\s+(install|test|i)\b/.test(joined);
}
