import { missingSecret, secretFromEnv, verifyLinearSignature } from "../crypto";
import type { IncomingIssue, IntegrationPlugin, ParseResult } from "../types";

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
    attrs: { teamId: data.teamId ?? "" },
    linearTeamId: data.teamId,
  };
}

export const linearPlugin: IntegrationPlugin = {
  id: "linear",
  label: "Linear",
  description: "Accept Linear issue webhooks",
  secretEnv: "LINEAR_WEBHOOK_SECRET",
  defaultEnabled: false,
  fallbackToSingle: true,
  settingsFields: [
    {
      key: "teamId",
      label: "Team ID (required if more than one Linear-enabled project)",
      placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      kind: "text",
    },
    {
      key: "label",
      label: "Required label (blank = every created issue)",
      kind: "text",
    },
  ],
  webhookUrl: (origin) => `${origin.replace(/\/$/, "")}/api/webhooks/linear`,
  verify(ctx) {
    const secret = secretFromEnv("LINEAR_WEBHOOK_SECRET");
    if (!secret) return missingSecret("LINEAR_WEBHOOK_SECRET");
    if (!verifyLinearSignature(secret, ctx.raw, ctx.headers.get("linear-signature"))) {
      return { ok: false, status: 401, error: "invalid signature" };
    }
    return { ok: true };
  },
  parse(ctx): ParseResult {
    const issue = parseLinearIssueEvent(ctx.payload);
    if (!issue) return { kind: "ignore", reason: "event not an ingestible issue" };
    return { kind: "issue", issue };
  },
  match(issue, _project, settings) {
    const want = String(settings.teamId ?? "");
    if (!want) return false;
    return want === (issue.attrs.teamId ?? issue.linearTeamId ?? "");
  },
};
