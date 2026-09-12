import { afterEach, describe, expect, it } from "vitest";
import {
  allowedOrigins,
  decodeSecret,
  llmApiKey,
  llmBaseUrl,
  llmConfigured,
  llmModel,
  normalizeLlmBaseUrl,
  resetEnvCache,
} from "./env";

describe("normalizeLlmBaseUrl", () => {
  it("strips chat/completions, responses, and models suffixes", () => {
    expect(normalizeLlmBaseUrl("https://opencode.ai/zen/go/v1/chat/completions")).toBe(
      "https://opencode.ai/zen/go/v1",
    );
    expect(normalizeLlmBaseUrl("https://opencode.ai/zen/go/v1/chat/completions/")).toBe(
      "https://opencode.ai/zen/go/v1",
    );
    expect(normalizeLlmBaseUrl("https://opencode.ai/zen/go/v1/responses")).toBe(
      "https://opencode.ai/zen/go/v1",
    );
    expect(normalizeLlmBaseUrl("https://opencode.ai/zen/go/v1/models")).toBe(
      "https://opencode.ai/zen/go/v1",
    );
  });

  it("keeps a /v1 root unchanged", () => {
    expect(normalizeLlmBaseUrl("https://opencode.ai/zen/go/v1")).toBe(
      "https://opencode.ai/zen/go/v1",
    );
    expect(normalizeLlmBaseUrl("https://api.x.ai/v1/")).toBe("https://api.x.ai/v1");
  });
});

describe("llmBaseUrl", () => {
  afterEach(() => {
    delete process.env.OPENAI_COMPAT_BASE_URL;
  });

  it("normalizes OPENAI_COMPAT_BASE_URL from env", () => {
    process.env.OPENAI_COMPAT_BASE_URL = "https://opencode.ai/zen/go/v1/chat/completions";
    expect(llmBaseUrl()).toBe("https://opencode.ai/zen/go/v1");
  });
});

describe("env helpers", () => {
  afterEach(() => {
    delete process.env.OPENAI_COMPAT_MODEL;
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.FACTORY_ORIGIN;
    resetEnvCache();
  });

  it("defaults the model to grok-4.5 and reports when a key is present", () => {
    delete process.env.OPENAI_COMPAT_MODEL;
    expect(llmModel()).toBe("grok-4.5");
    process.env.OPENAI_COMPAT_MODEL = "grok-4.6";
    expect(llmModel()).toBe("grok-4.6");
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(llmConfigured()).toBe(false);
    process.env.XAI_API_KEY = "xai-test";
    expect(llmConfigured()).toBe(true);
    expect(llmApiKey()).toBe("xai-test");
  });

  it("splits FACTORY_ORIGIN into allowed origins", () => {
    process.env.FACTORY_SECRET = "ab".repeat(32);
    process.env.FACTORY_APP_PASSWORD = "pw";
    process.env.FACTORY_ORIGIN = "https://a.example, https://b.example";
    resetEnvCache();
    expect(allowedOrigins()).toEqual(["https://a.example", "https://b.example"]);
  });

  it("accepts a base64 FACTORY_SECRET", () => {
    const raw = Buffer.alloc(32, 7);
    expect(decodeSecret(`base64:${raw.toString("base64")}`, "FACTORY_SECRET").equals(raw)).toBe(true);
    expect(() => decodeSecret("base64:QQ==", "FACTORY_SECRET")).toThrow(/at least 32 bytes/);
    expect(() => decodeSecret(undefined, "FACTORY_SECRET")).toThrow(/required/);
  });
});
