import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  formatLlmError,
  isParseLlmError,
  isRetryableLlmError,
  parseStructured,
  recoverStructuredValue,
  repairStructuredText,
  withLlmAttempts,
} from "./llm-parse";

const Mini = z.object({
  version: z.literal(1),
  classification: z.enum(["simple", "complex"]),
  risk: z.enum(["low", "medium", "high"]),
  rationale: z.string(),
  affectedAreas: z.array(z.string()).default([]),
  fastTrack: z.boolean(),
});

const yamlFence = `\`\`\`yaml
version: 1
classification: simple
risk: low
rationale: There is a bug in test.js
affectedAreas:
  - test.js
fastTrack: true
\`\`\``;

describe("recoverStructuredValue", () => {
  it("recovers a fenced YAML object (the OpenCode GLM failure mode)", () => {
    expect(recoverStructuredValue(yamlFence)).toEqual({
      version: 1,
      classification: "simple",
      risk: "low",
      rationale: "There is a bug in test.js",
      affectedAreas: ["test.js"],
      fastTrack: true,
    });
  });

  it("recovers fenced JSON and JSON buried in prose", () => {
    expect(recoverStructuredValue('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(recoverStructuredValue('Here you go:\n{"a":1,"b":[2]}\nThanks')).toEqual({ a: 1, b: [2] });
  });

  it("recovers JSON with trailing commas", () => {
    expect(recoverStructuredValue('{"a":1,}')).toEqual({ a: 1 });
  });

  it("returns undefined for empty or non-structured text", () => {
    expect(recoverStructuredValue("")).toBeUndefined();
    expect(recoverStructuredValue("just thinking out loud")).toBeUndefined();
  });
});

describe("parseStructured / repairStructuredText", () => {
  it("validates recovered YAML against a Zod schema", () => {
    const parsed = parseStructured(yamlFence, Mini);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.classification).toBe("simple");
  });

  it("repairs YAML into a JSON string", async () => {
    const repaired = await repairStructuredText({ text: yamlFence });
    expect(repaired).toBeTruthy();
    expect(JSON.parse(repaired!)).toMatchObject({ version: 1, fastTrack: true });
  });

  it("fails closed when the schema does not match", () => {
    const parsed = parseStructured('{"version":2}', Mini);
    expect(parsed.ok).toBe(false);
  });
});

describe("error classification", () => {
  it("treats parse failures and 5xx as retryable, auth errors as not", () => {
    expect(isParseLlmError({ name: "AI_NoObjectGeneratedError", message: "could not parse" })).toBe(true);
    expect(isRetryableLlmError({ name: "AI_NoObjectGeneratedError", message: "could not parse" })).toBe(true);
    expect(isRetryableLlmError({ message: "Internal server error", statusCode: 500, isRetryable: true })).toBe(
      true,
    );
    expect(isRetryableLlmError({ name: "AI_RetryError", message: "Failed after 3 attempts" })).toBe(true);
    expect(isRetryableLlmError({ message: "unauthorized", statusCode: 401 })).toBe(false);
    expect(isRetryableLlmError({ name: "AbortError", message: "aborted" })).toBe(false);
  });

  it("includes model output in formatted errors", () => {
    const msg = formatLlmError({
      message: "No object generated",
      text: yamlFence,
      statusCode: 200,
    });
    expect(msg).toMatch(/No object generated/);
    expect(msg).toMatch(/yaml/);
  });
});

describe("withLlmAttempts", () => {
  it("retries retryable errors then returns", async () => {
    let n = 0;
    const value = await withLlmAttempts({
      maxAttempts: 3,
      sleep: async () => {},
      operation: async () => {
        n += 1;
        if (n < 3) {
          const err = new Error("Internal server error") as Error & { statusCode: number; isRetryable: boolean };
          err.statusCode = 500;
          err.isRetryable = true;
          throw err;
        }
        return "ok";
      },
    });
    expect(value).toBe("ok");
    expect(n).toBe(3);
  });

  it("does not retry non-retryable errors", async () => {
    let n = 0;
    await expect(
      withLlmAttempts({
        maxAttempts: 3,
        sleep: async () => {},
        operation: async () => {
          n += 1;
          const err = new Error("bad key") as Error & { statusCode: number };
          err.statusCode = 401;
          throw err;
        },
      }),
    ).rejects.toThrow(/bad key/);
    expect(n).toBe(1);
  });
});
