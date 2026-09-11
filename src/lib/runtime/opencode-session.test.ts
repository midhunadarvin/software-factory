import { afterEach, describe, expect, it } from "vitest";
import {
  FACTORY_USER_AGENT,
  OPENCODE_SESSION_HEADER,
  isOpenCodeHost,
  mergeLlmHeaders,
  openCodeSessionId,
  resetOpenCodeSessionFallback,
} from "./opencode-session";

describe("isOpenCodeHost", () => {
  it("matches opencode.ai and subdomains", () => {
    expect(isOpenCodeHost("https://opencode.ai/zen/go/v1")).toBe(true);
    expect(isOpenCodeHost("https://opencode.ai/zen/go/v1/chat/completions")).toBe(true);
    expect(isOpenCodeHost("https://api.opencode.ai/v1")).toBe(true);
    expect(isOpenCodeHost("opencode.ai")).toBe(true);
  });

  it("does not match other providers", () => {
    expect(isOpenCodeHost("https://api.x.ai/v1")).toBe(false);
    expect(isOpenCodeHost("https://api.openai.com/v1")).toBe(false);
    expect(isOpenCodeHost("https://notopencode.ai/v1")).toBe(false);
  });
});

describe("openCodeSessionId", () => {
  afterEach(() => {
    resetOpenCodeSessionFallback();
  });

  it("uses the job scope when present", () => {
    expect(openCodeSessionId("job-abc")).toBe("job-abc");
    expect(openCodeSessionId("  job-abc  ")).toBe("job-abc");
  });

  it("reuses one fallback id when no scope is given", () => {
    const a = openCodeSessionId();
    const b = openCodeSessionId(undefined);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(b).toBe(a);
  });
});

describe("mergeLlmHeaders", () => {
  afterEach(() => {
    resetOpenCodeSessionFallback();
  });

  it("stamps session and user-agent on OpenCode hosts", () => {
    const headers = mergeLlmHeaders(
      "https://opencode.ai/zen/go/v1/chat/completions",
      { Authorization: "Bearer sk-test" },
      "job-1",
    );
    expect(headers.get(OPENCODE_SESSION_HEADER)).toBe("job-1");
    expect(headers.get("user-agent")).toBe(FACTORY_USER_AGENT);
    expect(headers.get("authorization")).toBe("Bearer sk-test");
  });

  it("is stable across turns of the same job", () => {
    const first = mergeLlmHeaders("https://opencode.ai/zen/go/v1", undefined, "job-1");
    const second = mergeLlmHeaders("https://opencode.ai/zen/go/v1", undefined, "job-1");
    expect(first.get(OPENCODE_SESSION_HEADER)).toBe("job-1");
    expect(second.get(OPENCODE_SESSION_HEADER)).toBe("job-1");
  });

  it("uses distinct ids for different jobs", () => {
    const a = mergeLlmHeaders("https://opencode.ai/zen/go/v1", undefined, "job-a");
    const b = mergeLlmHeaders("https://opencode.ai/zen/go/v1", undefined, "job-b");
    expect(a.get(OPENCODE_SESSION_HEADER)).toBe("job-a");
    expect(b.get(OPENCODE_SESSION_HEADER)).toBe("job-b");
  });

  it("lets a caller-supplied session header win", () => {
    const headers = mergeLlmHeaders(
      "https://opencode.ai/zen/go/v1",
      { [OPENCODE_SESSION_HEADER]: "already-set" },
      "job-1",
    );
    expect(headers.get(OPENCODE_SESSION_HEADER)).toBe("already-set");
  });

  it("does not add the header for non-OpenCode hosts", () => {
    const headers = mergeLlmHeaders("https://api.x.ai/v1/responses", undefined, "job-1");
    expect(headers.has(OPENCODE_SESSION_HEADER)).toBe(false);
    expect(headers.has("user-agent")).toBe(false);
  });
});
