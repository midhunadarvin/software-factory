import { missingSecret, secretFromEnv, verifySharedSecret } from "../crypto";
import type { IncomingIssue, IntegrationPlugin, ParseResult } from "../types";

export function jiraDescriptionToText(desc: unknown): string {
  if (typeof desc === "string") return desc;
  if (!desc || typeof desc !== "object") return "";
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.content)) for (const child of n.content) walk(child);
    if (n.type === "paragraph" || n.type === "heading") parts.push("\n");
  };
  walk(desc);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

export function parseJiraIssueEvent(payload: unknown): IncomingIssue | null {
  const body = payload as {
    webhookEvent?: string;
    issue?: {
      id?: string;
      key?: string;
      self?: string;
      fields?: {
        summary?: string;
        description?: unknown;
        labels?: string[];
        project?: { key?: string };
      };
    };
  };
  const event = body.webhookEvent ?? "";
  if (event && !["jira:issue_created", "jira:issue_updated"].includes(event)) return null;
  const issue = body.issue;
  if (!issue?.key) return null;
  const num = Number((issue.key.split("-").pop() ?? "").replace(/\D/g, ""));
  const self = issue.self ?? "";
  const origin = self.match(/^(https?:\/\/[^/]+)/i)?.[1] ?? "";
  const projectKey = issue.fields?.project?.key ?? issue.key.split("-")[0] ?? "";
  return {
    source: "jira",
    externalKey: `jira:${issue.key}`,
    issueNumber: Number.isFinite(num) && num > 0 ? num : null,
    title: issue.fields?.summary?.trim() || issue.key,
    body: jiraDescriptionToText(issue.fields?.description),
    url: origin ? `${origin}/browse/${issue.key}` : "",
    labels: issue.fields?.labels ?? [],
    attrs: { projectKey },
    jiraProjectKey: projectKey,
  };
}

export const jiraPlugin: IntegrationPlugin = {
  id: "jira",
  label: "Jira",
  description: "Accept Jira issue webhooks",
  secretEnv: "JIRA_WEBHOOK_SECRET",
  defaultEnabled: false,
  fallbackToSingle: true,
  settingsFields: [
    { key: "projectKey", label: "Project key (e.g. ENG)", placeholder: "ENG", kind: "text" },
    { key: "label", label: "Required label (blank = every created issue)", kind: "text" },
  ],
  webhookUrl: (origin) =>
    `${origin.replace(/\/$/, "")}/api/webhooks/jira?secret=YOUR_JIRA_WEBHOOK_SECRET`,
  verify(ctx) {
    const secret = secretFromEnv("JIRA_WEBHOOK_SECRET");
    if (!secret) return missingSecret("JIRA_WEBHOOK_SECRET");
    const provided =
      ctx.url.searchParams.get("secret") ??
      ctx.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      ctx.headers.get("x-webhook-secret");
    if (!verifySharedSecret(secret, provided)) {
      return { ok: false, status: 401, error: "invalid secret" };
    }
    return { ok: true };
  },
  parse(ctx): ParseResult {
    const issue = parseJiraIssueEvent(ctx.payload);
    if (!issue) return { kind: "ignore", reason: "event not an ingestible issue" };
    return { kind: "issue", issue };
  },
  match(issue, _project, settings) {
    const want = String(settings.projectKey ?? "").toUpperCase();
    if (!want) return false;
    const got = (issue.attrs.projectKey ?? issue.jiraProjectKey ?? "").toUpperCase();
    return want === got;
  },
};
