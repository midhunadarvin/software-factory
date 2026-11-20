import fs from "node:fs";
import path from "node:path";
import { worktreePath } from "../paths";
import { runGit } from "./exec";

export function branchName(issueNumber: number, title: string, jobId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const n = Math.abs(issueNumber);
  return `factory/${n}-${slug || "job"}-${jobId.slice(0, 8)}`;
}

export async function addJobWorktree(opts: {
  rootPath: string;
  projectId: string;
  jobId: string;
  branch: string;
  defaultBranch: string;
}): Promise<string> {
  const dest = worktreePath(opts.projectId, opts.jobId);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const verify = await runGit(["rev-parse", "--verify", opts.defaultBranch], {
    cwd: opts.rootPath,
  });
  if (verify.code !== 0) {
    throw new Error(`default branch ${opts.defaultBranch} does not resolve`);
  }
  let r = await runGit(
    ["worktree", "add", "-b", opts.branch, dest, opts.defaultBranch],
    { cwd: opts.rootPath },
  );
  if (r.code !== 0 && /already exists/.test(r.stderr)) {
    r = await runGit(["worktree", "add", dest, opts.branch], { cwd: opts.rootPath });
  }
  if (r.code !== 0 && fs.existsSync(dest)) {
    await runGit(["worktree", "remove", "--force", dest], { cwd: opts.rootPath });
    r = await runGit(
      ["worktree", "add", "-b", opts.branch, dest, opts.defaultBranch],
      { cwd: opts.rootPath },
    );
  }
  if (r.code !== 0) {
    await runGit(["branch", "-D", opts.branch], { cwd: opts.rootPath }).catch(() => {});
    r = await runGit(
      ["worktree", "add", "-b", opts.branch, dest, opts.defaultBranch],
      { cwd: opts.rootPath },
    );
  }
  if (r.code !== 0) {
    throw new Error(r.stderr || r.stdout || "worktree add failed");
  }
  return dest;
}

export async function removeJobWorktree(rootPath: string, dest: string | null | undefined) {
  if (!dest) return;
  await runGit(["worktree", "remove", "--force", dest], { cwd: rootPath }).catch(() => {});
}
