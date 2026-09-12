export type IncomingIssue = {
  source: "github" | "linear" | "jira";
  externalKey: string;
  issueNumber: number | null;
  title: string;
  body: string;
  url: string;
  labels: string[];
  repoOwner?: string;
  repoName?: string;
  linearTeamId?: string;
  jiraProjectKey?: string;
};

export function labelsInclude(labels: string[], required: string): boolean {
  if (!required.trim()) return true;
  const want = required.trim().toLowerCase();
  return labels.some((l) => l.toLowerCase() === want);
}

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
    repoOwner: owner,
    repoName: repo,
  };
}

export function parseLinearIssueEvent(payload: unknown): IncomingIssue | null {
  const body = payload as {
    type?: string;
    action?: string;
    url?: string;
    data?: {
      id?: string;
      identifier?: string;
      number?: number;
      title?: string;
      description?: string | null;
      url?: string;
      teamId?: string;
      labels?: { name?: string }[];
    };
  };
  if (body.type && body.type !== "Issue") return null;
  if (body.action && !["create", "update"].includes(body.action)) return null;
  const data = body.data;
  if (!data?.id || !data.title) return null;
  const identifier = data.identifier ?? data.id;
  return {
    source: "linear",
    externalKey: `linear:${data.id}`,
    issueNumber: typeof data.number === "number" ? data.number : null,
    title: data.title.trim(),
    body: [identifier, data.description ?? ""].filter(Boolean).join("\n\n"),
    url: data.url ?? body.url ?? "",
    labels: (data.labels ?? []).map((l) => l.name ?? "").filter(Boolean),
    linearTeamId: data.teamId,
  };
}

/** Flatten Jira Cloud ADF (Atlassian Document Format) or a plain string. */
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
    issue_event_type_name?: string;
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
  return {
    source: "jira",
    externalKey: `jira:${issue.key}`,
    issueNumber: Number.isFinite(num) && num > 0 ? num : null,
    title: issue.fields?.summary?.trim() || issue.key,
    body: jiraDescriptionToText(issue.fields?.description),
    url: origin ? `${origin}/browse/${issue.key}` : "",
    labels: issue.fields?.labels ?? [],
    jiraProjectKey: issue.fields?.project?.key ?? issue.key.split("-")[0],
  };
}
