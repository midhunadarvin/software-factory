import { ingestIncomingIssue, readRawBody } from "@/lib/webhooks/handle";
import { parseGithubIssueEvent } from "@/lib/webhooks/parse";
import { verifyGithubSignature, webhookSecrets } from "@/lib/webhooks/verify";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = webhookSecrets().github;
  if (!secret) {
    return Response.json({ error: "GITHUB_WEBHOOK_SECRET is not set" }, { status: 503 });
  }
  const raw = await readRawBody(req);
  const sig = req.headers.get("x-hub-signature-256");
  if (!verifyGithubSignature(secret, raw, sig)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }
  const event = req.headers.get("x-github-event") ?? "";
  if (event === "ping") return Response.json({ ok: true, ping: true });
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const issue = parseGithubIssueEvent(payload, event);
  if (!issue) return Response.json({ ok: true, ignored: "event not an ingestible issue" });
  const result = await ingestIncomingIssue(issue);
  return Response.json(result);
}
