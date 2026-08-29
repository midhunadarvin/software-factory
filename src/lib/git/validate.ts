import fs from "node:fs";
import path from "node:path";
import { isInsideVar } from "../paths";
import { runGit } from "./exec";

export type ValidatePathResult = {
  ok: boolean;
  defaultBranch?: string;
  remotes: { name: string; url: string }[];
  github?: { owner: string; repo: string };
  error?: string;
};

export function parseGithubRemote(url: string): { owner: string; repo: string } | null {
  const cleaned = url.trim().replace(/\.git$/, "");
  const https = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
  if (https) return { owner: https[1], repo: https[2] };
  return null;
}

export async function validateGitPath(rootPath: string): Promise<ValidatePathResult> {
  const remotes: { name: string; url: string }[] = [];
  try {
    const abs = path.resolve(rootPath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      return { ok: false, remotes, error: "path is not a directory" };
    }
    if (isInsideVar(abs)) {
      return { ok: false, remotes, error: "cannot attach Factory var/ paths" };
    }
    const inside = await runGit(["rev-parse", "--is-inside-work-tree"], { cwd: abs });
    if (inside.code !== 0 || inside.stdout.trim() !== "true") {
      return { ok: false, remotes, error: "not a git work tree" };
    }
    const top = await runGit(["rev-parse", "--show-toplevel"], { cwd: abs });
    if (path.resolve(top.stdout.trim()) !== abs) {
      return { ok: false, remotes, error: "path must be the work-tree root" };
    }
    const remoteOut = await runGit(["remote", "-v"], { cwd: abs });
    for (const line of remoteOut.stdout.split("\n")) {
      const m = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)/);
      if (m) remotes.push({ name: m[1], url: m[2] });
    }
    const ghRemote =
      remotes.find((r) => r.name === "origin" && parseGithubRemote(r.url)) ??
      remotes.find((r) => parseGithubRemote(r.url));
    const github = ghRemote ? parseGithubRemote(ghRemote.url) ?? undefined : undefined;
    const branchOut = await runGit(["symbolic-ref", "refs/remotes/origin/HEAD"], {
      cwd: abs,
    });
    let defaultBranch = "main";
    if (branchOut.code === 0) {
      defaultBranch = branchOut.stdout.trim().split("/").pop() || "main";
    } else {
      const cur = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: abs });
      if (cur.code === 0 && cur.stdout.trim() && cur.stdout.trim() !== "HEAD") {
        defaultBranch = cur.stdout.trim();
      }
    }
    return { ok: true, defaultBranch, remotes, github };
  } catch (err) {
    return { ok: false, remotes, error: err instanceof Error ? err.message : String(err) };
  }
}
