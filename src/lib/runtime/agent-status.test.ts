import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAgentStatusCache, probeAgent } from "./agent-status";
import { OPENCODE_SESSION_HEADER, resetOpenCodeSessionFallback } from "./opencode-session";

describe("probeAgent", () => {
  afterEach(() => {
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.FACTORY_LLM_API_KEY;
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_COMPAT_BASE_URL;
    clearAgentStatusCache();
    resetOpenCodeSessionFallback();
    vi.unstubAllGlobals();
  });

  it("blocks when no key is set", async () => {
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.FACTORY_LLM_API_KEY;
    const s = await probeAgent();
    expect(s.ready).toBe(false);
    expect(s.configured).toBe(false);
    expect(s.error).toMatch(/FACTORY_LLM_API_KEY/);
  });

  it("sends x-opencode-session when probing OpenCode Go", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_COMPAT_BASE_URL = "https://opencode.ai/zen/go/v1";
    const seen: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Headers(init?.headers));
        return new Response(JSON.stringify({ data: [{ id: "glm-5.3-flash" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const s = await probeAgent();
    expect(s.ready).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].get(OPENCODE_SESSION_HEADER)).toBeTruthy();
  });
});
