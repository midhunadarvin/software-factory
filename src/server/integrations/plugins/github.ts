import { missingSecret, secretFromEnv, verifyGithubSignature } from "../crypto";
import type { IncomingIssue, IntegrationPlugin, ParseResult, WebhookContext } from "../types";

export function parseGithubIssueEvent(payload: unknown, event: string): IncomingIssue | null {
  if (event === "ping") return null;
  if (event !== "issues") return null;
  const body = payload as {
    action?: string;
    issue?: {
      number?: number;
      title?: string;
      body?: string | null;
      html_url?: string;
      pull_request?: unknown;
      labels?: { name?: string }[];
    };
    repository?: { owner?: { login?: string }; name?: string };
  };
  const action = body.action ?? "";
  if (!["opened", "reopened", "labeled"].includes(action)) return null;
  const issue = body.issue;
  if (!issue || issue.pull_request || typeof issue.number !== "number") return null;
  const owner = body.repository?.owner?.login ?? "";
  const repo = body.repository?.name ?? "";
  return {
    source: "github",
    externalKey: `github:${owner}/${repo}#${issue.number}`.toLowerCase(),
    issueNumber: issue.number,
    title: issue.title?.trim() || `Issue #${issue.number}`,
    body: issue.body ?? "",
    url: issue.html_url ?? "",
    labels: (issue.labels ?? []).map((l) => l.name ?? "").filter(Boolean),
    attrs: { repoOwner: owner, repoName: repo },
    repoOwner: owner,
    repoName: repo,
  };
}

export const githubPlugin: IntegrationPlugin = {
  id: "github",
  label: "GitHub",
  description: "Accept GitHub issue webhooks for this repo",
  secretEnv: "GITHUB_WEBHOOK_SECRET",
  defaultEnabled: true,
  fallbackToSingle: false,
  settingsFields: [
    {
      key: "label",
      label: "Required label (blank = every opened issue)",
      placeholder: "factory",
      kind: "text",
    },
  ],
  webhookUrl: (origin) => `${origin.replace(/\/$/, "")}/api/webhooks/github`,
  verify(ctx) {
    const secret = secretFromEnv("GITHUB_WEBHOOK_SECRET");
    if (!secret) return missingSecret("GITHUB_WEBHOOK_SECRET");
    if (!verifyGithubSignature(secret, ctx.raw, ctx.headers.get("x-hub-signature-256"))) {
      return { ok: false, status: 401, error: "invalid signature" };
    }
    return { ok: true };
  },
  parse(ctx): ParseResult {
    const event = ctx.headers.get("x-github-event") ?? "";
    if (event === "ping") return { kind: "ping" };
    const issue = parseGithubIssueEvent(ctx.payload, event);
    if (!issue) return { kind: "ignore", reason: "event not an ingestible issue" };
    return { kind: "issue", issue };
  },
  match(issue, project) {
    const owner = (issue.attrs.repoOwner ?? issue.repoOwner ?? "").toLowerCase();
    const repo = (issue.attrs.repoName ?? issue.repoName ?? "").toLowerCase();
    return (
      (project.repoOwner ?? "").toLowerCase() === owner && (project.repoName ?? "").toLowerCase() === repo
    );
  },
};
