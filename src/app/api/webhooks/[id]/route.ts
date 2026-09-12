import { handleIntegrationWebhook } from "@/lib/integrations/dispatch";
import { ingestIncomingIssue } from "@/lib/webhooks/handle";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> | { id: string } },
) {
  const params = await Promise.resolve(ctx.params);
  return handleIntegrationWebhook(params.id, req, ingestIncomingIssue);
}
