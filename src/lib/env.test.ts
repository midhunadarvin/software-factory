import { afterEach, describe, expect, it } from "vitest";
import { llmBaseUrl, normalizeLlmBaseUrl } from "./env";

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
