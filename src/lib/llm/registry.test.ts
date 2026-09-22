import { afterEach, describe, expect, it } from "vitest";
import {
  getLlmProvider,
  listLlmProviders,
  loadBuiltinLlmProviders,
  publicLlmProviders,
  registerLlmProvider,
  unregisterLlmProvider,
} from "./registry";
import { pickLlmPlugin, resolveLlmProvider } from "./resolve";
import { createChatModel } from "./sdk";
import type { LlmProviderPlugin } from "./types";

const stub: LlmProviderPlugin = {
  id: "stub_llm",
  label: "Stub LLM",
  description: "Test plugin",
  keyEnvs: ["STUB_LLM_KEY"],
  defaultBaseUrl: "https://stub.example/v1",
  defaultModel: "stub-1",
  priority: 200,
  match: (env) => env.apiKey === "stub-secret",
  listModels: async () => [{ id: "stub-1", style: "chat" }],
  apiStyle: () => "chat",
  createModel: (id, ctx) => createChatModel(id, ctx),
};

function clearKeys() {
  delete process.env.FACTORY_LLM_API_KEY;
  delete process.env.OPENCODE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.XAI_API_KEY;
  delete process.env.LLM_PROVIDER;
  delete process.env.OPENAI_COMPAT_BASE_URL;
  delete process.env.OPENAI_COMPAT_MODEL;
  delete process.env.STUB_LLM_KEY;
}

afterEach(() => {
  unregisterLlmProvider("stub_llm");
  unregisterLlmProvider("nope");
  loadBuiltinLlmProviders();
  clearKeys();
});

describe("llm provider registry", () => {
  it("loads xAI, OpenAI, OpenCode Go, and custom by default", () => {
    const ids = listLlmProviders().map((p) => p.id);
    expect(ids).toEqual(["xai", "openai", "opencode_go", "custom"]);
    expect(getLlmProvider("opencode-go")?.label).toBe("OpenCode Go");
    expect(publicLlmProviders().map((p) => p.id)).toEqual(ids);
  });

  it("rejects invalid ids", () => {
    expect(() => registerLlmProvider({ ...stub, id: "Not Valid" })).toThrow(/invalid LLM provider id/);
  });

  it("registers a third-party plugin used by resolveLlmProvider", () => {
    registerLlmProvider(stub);
    process.env.STUB_LLM_KEY = "stub-secret";
    process.env.FACTORY_LLM_API_KEY = "stub-secret";
    const resolved = resolveLlmProvider();
    expect(resolved?.plugin.id).toBe("stub_llm");
    expect(resolved?.baseUrl).toBe("https://stub.example/v1");
    const model = resolved?.plugin.createModel("stub-1", {
      apiKey: "stub-secret",
      baseUrl: resolved!.baseUrl,
      fetch,
    }) as { provider: string };
    expect(model.provider).toMatch(/chat/i);
  });
});

describe("resolveLlmProvider", () => {
  it("defaults a generic key to OpenCode Go", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(pickLlmPlugin()?.id).toBe("opencode_go");
    expect(resolveLlmProvider()?.baseUrl).toBe("https://opencode.ai/zen/go/v1");
  });

  it("selects xAI when XAI_API_KEY is set", () => {
    process.env.XAI_API_KEY = "xai-test";
    expect(pickLlmPlugin()?.id).toBe("xai");
    expect(resolveLlmProvider()?.baseUrl).toBe("https://api.x.ai/v1");
  });

  it("selects OpenAI when LLM_PROVIDER=openai", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.LLM_PROVIDER = "openai";
    expect(pickLlmPlugin()?.id).toBe("openai");
  });

  it("uses custom for an unknown OPENAI_COMPAT_BASE_URL host", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_COMPAT_BASE_URL = "https://llm.internal/v1/chat/completions";
    expect(pickLlmPlugin()?.id).toBe("custom");
    expect(resolveLlmProvider()?.baseUrl).toBe("https://llm.internal/v1");
  });

  it("maps an OpenCode hostname to the Go plugin", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_COMPAT_BASE_URL = "https://opencode.ai/zen/go/v1";
    expect(pickLlmPlugin()?.id).toBe("opencode_go");
  });

  it("throws on an unknown LLM_PROVIDER", () => {
    process.env.LLM_PROVIDER = "not_a_plugin";
    expect(() => pickLlmPlugin()).toThrow(/Unknown LLM_PROVIDER/);
  });
});
