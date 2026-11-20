import { describe, expect, it } from "vitest";
import { redact } from "./redact";

describe("redact", () => {
  it("strips GitHub PATs, OpenAI keys, and xAI keys", () => {
    expect(redact("token ghp_abcDEF123456 and gho_xyz789")).toBe("token [redacted] and [redacted]");
    expect(redact("OPENAI sk-abc_DEF-123")).toBe("OPENAI [redacted]");
    expect(redact("XAI xai-secretKEY_99")).toBe("XAI [redacted]");
  });

  it("leaves ordinary text alone", () => {
    expect(redact("factory: T-1 add healthcheck")).toBe("factory: T-1 add healthcheck");
  });
});
