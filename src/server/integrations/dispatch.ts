import { getIntegration } from "./registry";
import type { IncomingIssue } from "./types";

export async function readRawBody(req: Request): Promise<Buffer> {
  return Buffer.from(await req.arrayBuffer());
}

export async function handleIntegrationWebhook(
  id: string,
  req: Request,
  ingest: (issue: IncomingIssue) => Promise<unknown>,
): Promise<Response> {
  const plugin = getIntegration(id);
  if (!plugin) {
    return Response.json({ error: `unknown integration: ${id}` }, { status: 404 });
  }
  const raw = await readRawBody(req);
  const url = new URL(req.url);
  const ctx = { req, raw, headers: req.headers, url };
  const verified = plugin.verify(ctx);
  if (!verified.ok) {
    return Response.json({ error: verified.error }, { status: verified.status });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = plugin.parse({ ...ctx, payload });
  if (parsed.kind === "ping") return Response.json({ ok: true, ping: true });
  if (parsed.kind === "ignore") return Response.json({ ok: true, ignored: parsed.reason });
  const result = await ingest(parsed.issue);
  return Response.json(result);
}
