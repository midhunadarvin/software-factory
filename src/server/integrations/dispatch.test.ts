import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { handleIntegrationWebhook } from "./dispatch";

function post(url: string, body: string, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
}

describe("handleIntegrationWebhook", () => {
  const prev = process.env.GITHUB_WEBHOOK_SECRET;

  afterEach(() => {
    if (prev === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
    else process.env.GITHUB_WEBHOOK_SECRET = prev;
  });

  it("returns 404 for an unregistered plugin", async () => {
    const res = await handleIntegrationWebhook(
      "asana",
      post("http://localhost/api/webhooks/asana", "{}"),
      async () => ({}),
    );
    expect(res.status).toBe(404);
  });

  it("returns 503 when the plugin secret is missing", async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const res = await handleIntegrationWebhook(
      "github",
      post("http://localhost/api/webhooks/github", "{}"),
      async () => ({}),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/GITHUB_WEBHOOK_SECRET/);
  });

  it("accepts a GitHub ping and ignores non-issue events", async () => {
    const body = "{}";
    process.env.GITHUB_WEBHOOK_SECRET = "s3cret";
    const hex = createHmac("sha256", "s3cret").update(body).digest("hex");
    const ping = await handleIntegrationWebhook(
      "github",
      post("http://localhost/api/webhooks/github", body, {
        "x-hub-signature-256": `sha256=${hex}`,
        "x-github-event": "ping",
      }),
      async () => {
        throw new Error("should not ingest");
      },
    );
    expect(ping.status).toBe(200);
    expect(await ping.json()).toEqual({ ok: true, ping: true });
  });
});
