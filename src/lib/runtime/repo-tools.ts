import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { tool } from "ai";
import { commitProductChanges } from "../git/branch";
import { runGit } from "../git/exec";
import { wrapUntrusted } from "./untrusted";
import { assertExecAllowed, longTimeout, resolveInRoot } from "./sandbox";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "var", ".factory"]);

export function repoTools(
  worktree: string,
  opts: { write?: boolean; exec?: boolean; onCommit?: () => void } = { write: true, exec: false },
) {
  const write = opts.write !== false;
  const exec = Boolean(opts.exec);
  return {
    listDir: tool({
      description: "List files and folders in the worktree (relative path, default .)",
      inputSchema: z.object({
        path: z.string().default("."),
        depth: z.number().int().min(1).max(6).default(3),
      }),
      execute: async ({ path: p, depth }) => listDir(worktree, p, depth),
    }),
    readFile: tool({
      description: "Read a UTF-8 file from the worktree",
      inputSchema: z.object({
        path: z.string(),
        offset: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(400).optional(),
      }),
      execute: async ({ path: p, offset, limit }) => readFile(worktree, p, offset, limit),
    }),
    inspectRepo: tool({
      description: "Summarize the worktree: top-level files, package.json if present, and a short source listing",
      inputSchema: z.object({}),
      execute: async () => inspectRepo(worktree),
    }),
    grep: tool({
      description: "Search file contents in the worktree with a regular expression",
      inputSchema: z.object({
        pattern: z.string().min(1),
        path: z.string().default("."),
        glob: z.string().optional(),
        caseInsensitive: z.boolean().default(true),
        maxMatches: z.number().int().min(1).max(200).default(80),
      }),
      execute: async (input) => grep(worktree, input),
    }),
    ...(write
      ? {
          writeFile: tool({
            description: "Create or overwrite a file in the worktree",
            inputSchema: z.object({ path: z.string(), contents: z.string() }),
            execute: async ({ path: p, contents }) => writeFile(worktree, p, contents),
          }),
          replaceInFile: tool({
            description: "Replace one exact string in a worktree file",
            inputSchema: z.object({
              path: z.string(),
              oldString: z.string().min(1),
              newString: z.string(),
            }),
            execute: async ({ path: p, oldString, newString }) =>
              replaceInFile(worktree, p, oldString, newString),
          }),
        }
      : {}),
    gitStatus: tool({
      description: "Show git status in the worktree",
      inputSchema: z.object({}),
      execute: async () => {
        const r = await runGit(["status", "--porcelain", "-b"], { cwd: worktree });
        return (r.stdout || r.stderr || "(clean)").slice(0, 8_000);
      },
    }),
    gitDiff: tool({
      description: "Show the current git diff in the worktree",
      inputSchema: z.object({ staged: z.boolean().default(false) }),
      execute: async ({ staged }) => {
        const r = await runGit(staged ? ["diff", "--cached"] : ["diff"], { cwd: worktree });
        return wrapUntrusted("diff", (r.stdout || r.stderr || "").slice(0, 50_000));
      },
    }),
    ...(exec
      ? {
          exec: tool({
            description: "Run an allowlisted command in the worktree (git, node, pnpm, npm, python3, pytest, tsc)",
            inputSchema: z.object({ argv: z.array(z.string()).min(1) }),
            execute: async ({ argv }) => {
              assertExecAllowed(argv[0] ?? "");
              return execIn(worktree, argv);
            },
          }),
          gitCommit: tool({
            description:
              "Stage product-file changes and commit in the worktree. Never includes .factory/ plans or specs. After a successful commit this task is done — do not call more tools.",
            inputSchema: z.object({ message: z.string().min(1) }),
            execute: async ({ message }) => {
              const ok = await commitProductChanges(worktree, message);
              if (ok) opts.onCommit?.();
              return ok ? "committed" : "nothing to commit (factory notes under .factory/ are left untracked)";
            },
          }),
        }
      : {}),
  };
}

export function inspectRepo(root: string): string {
  const top = listDir(root, ".", 2, 80);
  const lines = [`top-level (${top.length}):`, ...top.slice(0, 60).map((p) => `- ${p}`)];
  for (const name of ["package.json", "tsconfig.json", "README.md", "test.js", "index.js"]) {
    try {
      const body = fs.readFileSync(path.join(root, name), "utf8");
      lines.push(`\n--- ${name} ---\n${body.slice(0, 4000)}`);
    } catch {
      /* missing */
    }
  }
  return lines.join("\n").slice(0, 20_000);
}

export function listDir(root: string, rel: string, depth: number, max = 400): string[] {
  const start = rel === "." ? root : resolveInRoot(root, rel);
  const out: string[] = [];
  const walk = (dir: string, d: number) => {
    if (out.length >= max || d > depth) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      out.push(path.relative(root, abs) + (e.isDirectory() ? "/" : ""));
      if (out.length >= max) return;
      if (e.isDirectory()) walk(abs, d + 1);
    }
  };
  walk(start, 0);
  return out;
}

export function readFile(root: string, rel: string, offset?: number, limit?: number): string {
  const abs = resolveInRoot(root, rel);
  const raw = fs.readFileSync(abs, "utf8");
  const lines = raw.split(/\r?\n/);
  const start = Math.max((offset ?? 1) - 1, 0);
  const slice = lines.slice(start, limit ? start + limit : undefined);
  return wrapUntrusted("file", slice.join("\n").slice(0, 80_000));
}

export function writeFile(root: string, rel: string, contents: string): string {
  const abs = resolveInRoot(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
  return `wrote ${rel} (${contents.length} bytes)`;
}

export function replaceInFile(root: string, rel: string, oldString: string, newString: string): string {
  const abs = resolveInRoot(root, rel);
  const raw = fs.readFileSync(abs, "utf8");
  const count = raw.split(oldString).length - 1;
  if (count === 0) return `no match for oldString in ${rel}`;
  if (count > 1) return `oldString matched ${count} times in ${rel}; make it unique`;
  fs.writeFileSync(abs, raw.replace(oldString, newString));
  return `replaced 1 occurrence in ${rel}`;
}

export function grep(
  root: string,
  opts: { pattern: string; path?: string; glob?: string; caseInsensitive?: boolean; maxMatches?: number },
): string {
  let re: RegExp;
  try {
    re = new RegExp(opts.pattern, opts.caseInsensitive === false ? "" : "i");
  } catch (err) {
    return `invalid regex: ${err instanceof Error ? err.message : String(err)}`;
  }
  const start = !opts.path || opts.path === "." ? root : resolveInRoot(root, opts.path);
  const max = opts.maxMatches ?? 80;
  const hits: string[] = [];
  const glob = opts.glob ? globToRegExp(opts.glob) : null;
  const walk = (dir: string) => {
    if (hits.length >= max) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits.length >= max) return;
      if (SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = path.relative(root, abs);
      if (glob && !glob.test(rel) && !glob.test(e.name)) continue;
      let text = "";
      try {
        text = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      if (text.includes("\0")) continue;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (hits.length >= max) break;
        if (re.test(lines[i]!)) hits.push(`${rel}:${i + 1}:${lines[i]!.slice(0, 240)}`);
      }
    }
  };
  if (fs.existsSync(start) && fs.statSync(start).isFile()) {
    walk(path.dirname(start));
  } else {
    walk(start);
  }
  return hits.length ? hits.join("\n") : "no matches";
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

export function execIn(cwd: string, argv: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = longTimeout(argv) ? 600_000 : 120_000;
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd,
      env: { ...process.env, HOME: cwd, CI: "1", TERM: "dumb" },
      stdio: ["ignore", "pipe", "pipe"] as const,
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      out += String(d);
    });
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("exec timeout"));
    }, timeout);
    child.on("close", (code) => {
      clearTimeout(t);
      resolve(`exit ${code}\n${out.slice(0, 8000)}`);
    });
    child.on("error", reject);
  });
}
