import { eq } from "drizzle-orm";
import { branchName } from "../git/worktree";
import { commitAll, currentBranch, ensureFeatureBranch } from "../git/branch";
import { runGit, runProcess } from "../git/exec";
import { gitEnvWithAskpass } from "../git/askpass";
import { createPullRequest, findPullRequest } from "../github/client";
import { decryptPat } from "../crypto/pat";
import { getDb } from "../db/client";
import { jobs, projects } from "../db/schema";
import { nowIso } from "../paths";
import type { PullRequestDraft } from "../artifacts/schemas";

export async function prepareFeatureBranch(opts: {
  jobId: string;
  worktreePath: string;
  issueNumber: number;
  issueTitle: string;
  storedBranch: string | null;
  defaultBranch: string;
}): Promise<{ branch: string; previous: string; created: boolean }> {
  const preferred =
    opts.storedBranch && !/^(main|master|develop|dev|trunk)$/.test(opts.storedBranch)
      ? opts.storedBranch
      : branchName(opts.issueNumber, opts.issueTitle, opts.jobId);
  const ensured = await ensureFeatureBranch({
    cwd: opts.worktreePath,
    defaultBranch: opts.defaultBranch,
    preferred,
  });
  if (ensured.branch !== opts.storedBranch) {
    await getDb()
      .update(jobs)
      .set({ branch: ensured.branch, updatedAt: nowIso() })
      .where(eq(jobs.id, opts.jobId));
  }
  return { branch: ensured.branch, previous: ensured.previous, created: ensured.created };
}

export async function commitPrPrep(worktree: string, issueNumber: number): Promise<boolean> {
  return commitAll(
    worktree,
    `factory(${Math.abs(issueNumber)}): remaining product changes (omit factory planning docs)`,
  );
}

export type PublishAttempt = {
  step: string;
  ok: boolean;
  code?: number;
  status?: number;
  detail: string;
};

export function clipDetail(text: string, max = 800): string {
  const trimmed = text.replace(/\s+$/g, "");
  if (!trimmed) return "";
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

export function formatPublishFailure(attempts: PublishAttempt[]): string {
  if (attempts.length === 0) return "GitHub create PR failed with no recorded attempts.";
  const lines = ["GitHub create PR failed."];
  for (const attempt of attempts) {
    const status =
      attempt.status != null
        ? ` HTTP ${attempt.status}`
        : attempt.code != null
          ? ` exit ${attempt.code}`
          : "";
    const detail = attempt.detail.trim() || "(no output)";
    lines.push(`- ${attempt.ok ? "ok" : "fail"} ${attempt.step}${status}: ${detail}`);
  }
  return lines.join("\n");
}

function commandDetail(r: { code: number; stdout: string; stderr: string }): string {
  return clipDetail([r.stderr, r.stdout].filter((s) => s.trim()).join("\n") || `exit ${r.code}`);
}

export async function publishPullRequest(opts: {
  jobId: string;
  projectId: string;
  worktreePath: string;
  branch: string;
  defaultBranch: string;
  title: string;
  body: string;
  draft?: boolean;
  issueNumber?: number;
}): Promise<{ url: string | null; number: number | null; pushed: boolean; attempts: PublishAttempt[] }> {
  const attempts: PublishAttempt[] = [];
  const project = (
    await getDb().select().from(projects).where(eq(projects.id, opts.projectId)).limit(1)
  )[0];
  if (
    !project ||
    project.remoteKind !== "github" ||
    !project.githubPatCiphertext ||
    !project.repoOwner ||
    !project.repoName
  ) {
    return { url: null, number: null, pushed: false, attempts };
  }
  const pat = decryptPat(project.id, {
    ciphertext: project.githubPatCiphertext,
    iv: project.githubPatIv!,
    tag: project.githubPatTag!,
  });
  const { env, cleanup } = gitEnvWithAskpass(pat);
  try {
    await commitPrPrep(opts.worktreePath, opts.issueNumber ?? 0);
    const push = await runGit(["push", "-u", "origin", opts.branch], {
      cwd: opts.worktreePath,
      env,
    });
    attempts.push({
      step: `git push -u origin ${opts.branch}`,
      ok: push.code === 0,
      code: push.code,
      detail: commandDetail(push) || (push.code === 0 ? "pushed" : "push failed"),
    });
    if (push.code !== 0) throw new Error(formatPublishFailure(attempts));

    const viaGh = await createPrWithGh({
      cwd: opts.worktreePath,
      token: pat,
      title: opts.title,
      body: opts.body,
      base: opts.defaultBranch,
      head: opts.branch,
      draft: opts.draft ?? false,
    });
    attempts.push(...viaGh.attempts);
    if (viaGh.ok) return { url: viaGh.url, number: viaGh.number, pushed: true, attempts };

    const created = await createPullRequest(pat, project.repoOwner, project.repoName, {
      title: opts.title,
      body: opts.body,
      head: opts.branch,
      base: opts.defaultBranch,
      draft: opts.draft ?? false,
    });
    attempts.push({
      step: `POST /repos/${project.repoOwner}/${project.repoName}/pulls`,
      ok: created.status === 201,
      status: created.status,
      detail: clipDetail(created.text || `GitHub create PR returned ${created.status}`),
    });
    if (created.status === 201) {
      const body = created.json as { html_url: string; number: number };
      return { url: body.html_url, number: body.number, pushed: true, attempts };
    }
    const found = await findPullRequest(
      pat,
      project.repoOwner,
      project.repoName,
      opts.branch,
    );
    attempts.push({
      step: `GET /repos/${project.repoOwner}/${project.repoName}/pulls?head=${project.repoOwner}:${opts.branch}`,
      ok: Boolean(found?.html_url),
      detail: found?.html_url ?? "no open PR on this head",
    });
    if (found?.html_url) {
      return { url: found.html_url, number: found.number, pushed: true, attempts };
    }
    throw new Error(formatPublishFailure(attempts));
  } finally {
    cleanup();
  }
}

export function parseGhPrOutput(text: string): { url: string; number: number } | null {
  const match = text.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
  if (!match) return null;
  return { url: match[0].replace(/[)>.,]+$/, ""), number: Number(match[1]) };
}

async function createPrWithGh(opts: {
  cwd: string;
  token: string;
  title: string;
  body: string;
  base: string;
  head: string;
  draft: boolean;
}): Promise<
  | { ok: true; url: string; number: number; attempts: PublishAttempt[] }
  | { ok: false; attempts: PublishAttempt[] }
> {
  const attempts: PublishAttempt[] = [];
  const env = {
    ...process.env,
    GH_TOKEN: opts.token,
    GITHUB_TOKEN: opts.token,
    GH_PROMPT_DISABLED: "1",
  };
  const createArgs = [
    "pr",
    "create",
    "--title",
    opts.title,
    "--body",
    opts.body,
    "--base",
    opts.base,
    "--head",
    opts.head,
  ];
  if (opts.draft) createArgs.push("--draft");
  try {
    const created = await runProcess("gh", createArgs, { cwd: opts.cwd, env });
    const parsed = parseGhPrOutput(`${created.stdout}\n${created.stderr}`);
    attempts.push({
      step: "gh pr create",
      ok: Boolean(parsed),
      code: created.code,
      detail: parsed ? parsed.url : commandDetail(created),
    });
    if (parsed) return { ok: true, ...parsed, attempts };
    const viewed = await runProcess(
      "gh",
      ["pr", "view", "--json", "url,number", "--head", opts.head],
      { cwd: opts.cwd, env },
    );
    let viewUrl: string | null = null;
    let viewNumber: number | null = null;
    if (viewed.code === 0 && viewed.stdout.trim()) {
      try {
        const json = JSON.parse(viewed.stdout) as { url?: string; number?: number };
        if (json.url && json.number) {
          viewUrl = json.url;
          viewNumber = json.number;
        }
      } catch {
        /* keep raw output below */
      }
    }
    attempts.push({
      step: `gh pr view --head ${opts.head}`,
      ok: Boolean(viewUrl && viewNumber),
      code: viewed.code,
      detail: viewUrl ?? commandDetail(viewed),
    });
    if (viewUrl && viewNumber) return { ok: true, url: viewUrl, number: viewNumber, attempts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    attempts.push({
      step: "gh pr create",
      ok: false,
      detail: /ENOENT|not found/i.test(message)
        ? `gh CLI is not installed or not on PATH (${message})`
        : clipDetail(message),
    });
  }
  return { ok: false, attempts };
}

export function describeBranchState(previous: string, branch: string, defaultBranch: string) {
  return {
    previous,
    branch,
    defaultBranch,
    onFeatureBranch: previous === branch,
  };
}

export { currentBranch };
