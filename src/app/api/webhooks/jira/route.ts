import { ingestIncomingIssue, readRawBody } from "@/lib/webhooks/handle";
import { parseJiraIssueEvent } from "@/lib/webhooks/parse";
import { verifySharedSecret, webhookSecrets } from "@/lib/webhooks/verify";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = webhookSecrets().jira;
  if (!secret) {
    return Response.json({ error: "JIRA_WEBHOOK_SECRET is not set" }, { status: 503 });
  }
  const url = new URL(req.url);
  const provided =
    url.searchParams.get("secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.headers.get("x-webhook-secret");
  if (!verifySharedSecret(secret, provided)) {
    return Response.json({ error: "invalid secret" }, { status: 401 });
  }
  const raw = await readRawBody(req);
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const issue = parseJiraIssueEvent(payload);
  if (!issue) return Response.json({ ok: true, ignored: "event not an ingestible issue" });
  const result = await ingestIncomingIssue(issue);
  return Response.json(result);
}
