import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  clearModelListCache,
  completeObject,
  completeText,
  deltaOf,
  getModel,
  listAvailableModels,
  llmApiStyle,
  type LlmHooks,
} from "./llm";
import { OPENCODE_SESSION_HEADER, resetOpenCodeSessionFallback } from "./opencode-session";
import { loadBuiltinLlmProviders, registerLlmProvider, unregisterLlmProvider } from "../llm/registry";
import { createChatModel } from "../llm/sdk";

describe("deltaOf", () => {
  it("reads AI SDK v5 delta fields used by Responses models like gpt-5.6-luna", () => {
    expect(deltaOf({ delta: "step one" })).toBe("step one");
    expect(deltaOf({ text: "legacy" })).toBe("legacy");
    expect(deltaOf({ textDelta: "old" })).toBe("old");
    expect(deltaOf({ reasoning: "why" })).toBe("why");
    expect(deltaOf({})).toBe("");
  });
});

describe("llmApiStyle", () => {
  it("uses chat completions for OpenCode Go GLM", () => {
    expect(llmApiStyle("glm-5.3-flash", "https://opencode.ai/zen/go/v1")).toBe("chat");
    expect(llmApiStyle("kimi-k2.6", "https://opencode.ai/zen/go/v1")).toBe("chat");
    expect(llmApiStyle("deepseek-v4-pro", "https://opencode.ai/zen/go/v1")).toBe("chat");
  });

  it("uses the Responses API for Grok/GPT on OpenCode Go and for xAI", () => {
    expect(llmApiStyle("grok-4.6", "https://opencode.ai/zen/go/v1")).toBe("responses");
    expect(llmApiStyle("gpt-5.6-luna", "https://opencode.ai/zen/go/v1")).toBe("responses");
    expect(llmApiStyle("grok-4.5", "https://api.x.ai/v1")).toBe("responses");
    expect(llmApiStyle("glm-5.3-flash", "https://api.x.ai/v1")).toBe("responses");
  });

  it("uses Anthropic Messages for OpenCode Go Qwen and MiniMax", () => {
    expect(llmApiStyle("qwen3.7-plus", "https://opencode.ai/zen/go/v1")).toBe("messages");
    expect(llmApiStyle("minimax-m2.7", "https://opencode.ai/zen/go/v1")).toBe("messages");
  });
});

describe("getModel", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.FACTORY_LLM_API_KEY;
    delete process.env.LLM_PROVIDER;
    delete process.env.STUB_LLM_KEY;
    delete process.env.OPENAI_COMPAT_BASE_URL;
    delete process.env.OPENAI_COMPAT_MODEL;
    unregisterLlmProvider("stub_llm");
    loadBuiltinLlmProviders();
  });

  it("builds a chat-completions model for OpenCode Go GLM without a base URL", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_COMPAT_MODEL = "glm-5.3-flash";
    const model = getModel() as { provider: string };
    expect(model.provider).toMatch(/chat/i);
    expect(model.provider).not.toMatch(/responses/i);
  });

  it("builds a chat-completions model for OpenCode Go GLM", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_COMPAT_BASE_URL = "https://opencode.ai/zen/go/v1/chat/completions";
    process.env.OPENAI_COMPAT_MODEL = "glm-5.3-flash";
    const model = getModel() as { provider: string };
    expect(model.provider).toMatch(/chat/i);
    expect(model.provider).not.toMatch(/responses/i);
  });

  it("builds a Responses model for Grok on OpenCode Go", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_COMPAT_BASE_URL = "https://opencode.ai/zen/go/v1";
    process.env.OPENAI_COMPAT_MODEL = "grok-4.6";
    const model = getModel() as { provider: string };
    expect(model.provider).toMatch(/responses/i);
  });

  it("builds a Messages model for OpenCode Go Qwen", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_COMPAT_MODEL = "qwen3.7-plus";
    const model = getModel() as { provider: string };
    expect(model.provider).toMatch(/anthropic/i);
  });

  it("uses a registered stub plugin without special-casing built-in ids", () => {
    registerLlmProvider({
      id: "stub_llm",
      label: "Stub",
      description: "test",
      keyEnvs: ["STUB_LLM_KEY"],
      defaultBaseUrl: "https://stub.example/v1",
      defaultModel: "stub-1",
      priority: 200,
      match: () => false,
      listModels: async () => [{ id: "stub-1", style: "chat" }],
      apiStyle: () => "chat",
      createModel: (id, ctx) => createChatModel(id, ctx),
    });
    process.env.LLM_PROVIDER = "stub_llm";
    process.env.STUB_LLM_KEY = "k";
    process.env.OPENAI_COMPAT_MODEL = "stub-1";
    const model = getModel() as { provider: string };
    expect(model).toBeTruthy();
    expect(model.provider).toMatch(/chat/i);
  });
});

describe("listAvailableModels", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_COMPAT_BASE_URL;
    delete process.env.OPENAI_COMPAT_MODEL;
    resetOpenCodeSessionFallback();
    clearModelListCache();
    vi.unstubAllGlobals();
  });

  it("sends x-opencode-session when listing OpenCode Go models", async () => {
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
    const out = await listAvailableModels();
    expect(out.models.map((m) => m.id)).toContain("glm-5.3-flash");
    expect(out.provider?.id).toBe("opencode_go");
    expect(seen).toHaveLength(1);
    expect(seen[0].get(OPENCODE_SESSION_HEADER)).toBeTruthy();
  });
});

const Mini = z.object({
  version: z.literal(1),
  classification: z.enum(["simple", "complex"]),
  risk: z.enum(["low", "medium", "high"]),
  rationale: z.string(),
  affectedAreas: z.array(z.string()).default([]),
  fastTrack: z.boolean(),
});

const valid = {
  version: 1 as const,
  classification: "simple" as const,
  risk: "low" as const,
  rationale: "There is a bug in test.js",
  affectedAreas: ["test.js"],
  fastTrack: true,
};

const yamlFence = `\`\`\`yaml
version: 1
classification: simple
risk: low
rationale: There is a bug in test.js
affectedAreas:
  - test.js
fastTrack: true
\`\`\``;

function withKey() {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.OPENAI_COMPAT_BASE_URL = "https://opencode.ai/zen/go/v1";
  process.env.OPENAI_COMPAT_MODEL = "glm-5.3-flash";
}

function objectStream(text: string, object?: unknown) {
  const err = Object.assign(new Error("No object generated: could not parse the response."), {
    name: "AI_NoObjectGeneratedError",
    text,
  });
  return {
    fullStream: (async function* () {
      yield { type: "text-delta" as const, textDelta: text };
    })(),
    object: object === undefined ? Promise.reject(err) : Promise.resolve(object),
    text: Promise.resolve(text),
  };
}

function textStream(text: string) {
  return {
    fullStream: (async function* () {
      yield { type: "text-delta" as const, text };
    })(),
    text: Promise.resolve(text),
  };
}

describe("completeObject", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_COMPAT_BASE_URL;
    delete process.env.OPENAI_COMPAT_MODEL;
  });

  it("repairs fenced YAML without a second API call", async () => {
    withKey();
    let objectCalls = 0;
    let textCalls = 0;
    const hooks: LlmHooks = {
      streamObject: (() => {
        objectCalls += 1;
        return objectStream(yamlFence);
      }) as unknown as LlmHooks["streamObject"],
      streamText: (() => {
        textCalls += 1;
        return textStream("{}");
      }) as unknown as LlmHooks["streamText"],
      sleep: async () => {},
    };
    const out = await completeObject({
      system: "triage",
      prompt: "classify",
      schema: Mini,
      hooks,
    });
    expect(out).toMatchObject(valid);
    expect(objectCalls).toBe(1);
    expect(textCalls).toBe(0);
  });

  it("falls back to a JSON-only text call after an unrecoverable object parse", async () => {
    withKey();
    let objectCalls = 0;
    const hooks: LlmHooks = {
      streamObject: (() => {
        objectCalls += 1;
        return objectStream("```yaml\nnot-an-object\n```");
      }) as unknown as LlmHooks["streamObject"],
      streamText: (() => textStream(JSON.stringify(valid))) as unknown as LlmHooks["streamText"],
      sleep: async () => {},
    };
    const out = await completeObject({
      system: "triage",
      prompt: "classify",
      schema: Mini,
      hooks,
    });
    expect(out.classification).toBe("simple");
    expect(objectCalls).toBe(1);
  });

  it("retries a 500 on streamObject via a JSON text fallback", async () => {
    withKey();
    let objectCalls = 0;
    let textCalls = 0;
    const hooks: LlmHooks = {
      streamObject: (() => {
        objectCalls += 1;
        const err = Object.assign(new Error("Internal server error"), {
          statusCode: 500,
          isRetryable: true,
        });
        return {
          fullStream: (async function* () {
            throw err;
          })(),
          object: Promise.resolve(undefined),
          text: Promise.resolve(""),
        };
      }) as unknown as LlmHooks["streamObject"],
      streamText: (() => {
        textCalls += 1;
        return textStream(JSON.stringify(valid));
      }) as unknown as LlmHooks["streamText"],
      sleep: async () => {},
    };
    const out = await completeObject({
      system: "triage",
      prompt: "classify",
      schema: Mini,
      hooks,
    });
    expect(out.fastTrack).toBe(true);
    expect(objectCalls).toBe(1);
    expect(textCalls).toBe(1);
  });
});

describe("completeText", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_COMPAT_BASE_URL;
    delete process.env.OPENAI_COMPAT_MODEL;
  });

  it("streams text and retries transient failures", async () => {
    withKey();
    let n = 0;
    const hooks: LlmHooks = {
      streamText: (() => {
        n += 1;
        if (n === 1) {
          const err = Object.assign(new Error("fetch failed"), { isRetryable: true });
          return {
            fullStream: (async function* () {
              throw err;
            })(),
            text: Promise.resolve(""),
          };
        }
        return textStream("hello");
      }) as unknown as LlmHooks["streamText"],
      sleep: async () => {},
    };
    const parts: string[] = [];
    const out = await completeText({
      system: "think",
      prompt: "go",
      hooks,
      onPart: (p) => parts.push(p.delta),
    });
    expect(out).toBe("hello");
    expect(parts).toEqual(["hello"]);
    expect(n).toBe(2);
  });
});

