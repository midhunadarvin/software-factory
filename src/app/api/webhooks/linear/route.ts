import { ingestIncomingIssue, readRawBody } from "@/lib/webhooks/handle";
import { parseLinearIssueEvent } from "@/lib/webhooks/parse";
import { verifyLinearSignature, webhookSecrets } from "@/lib/webhooks/verify";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = webhookSecrets().linear;
  if (!secret) {
    return Response.json({ error: "LINEAR_WEBHOOK_SECRET is not set" }, { status: 503 });
  }
  const raw = await readRawBody(req);
  const sig = req.headers.get("linear-signature");
  if (!verifyLinearSignature(secret, raw, sig)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const issue = parseLinearIssueEvent(payload);
  if (!issue) return Response.json({ ok: true, ignored: "event not an ingestible issue" });
  const result = await ingestIncomingIssue(issue);
  return Response.json(result);
}
