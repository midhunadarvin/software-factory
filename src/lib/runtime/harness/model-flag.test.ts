import { describe, expect, it } from "vitest";
import { cliSpawnEnv, modelFlagForHarness } from "./model-flag";

describe("modelFlagForHarness", () => {
  it("never forwards glm-5.3-flash to Claude", () => {
    expect(modelFlagForHarness("claude", "glm-5.3-flash")).toBeUndefined();
    expect(modelFlagForHarness("claude", "sonnet")).toBe("sonnet");
    expect(modelFlagForHarness("claude", "default")).toBeUndefined();
    expect(modelFlagForHarness("claude", "claude-opus-4-7")).toBe("claude-opus-4-7");
  });

  it("never forwards the in-process default to Cursor", () => {
    const prev = process.env.OPENAI_COMPAT_MODEL;
    process.env.OPENAI_COMPAT_MODEL = "glm-5.3-flash";
    try {
      expect(modelFlagForHarness("cursor", "glm-5.3-flash")).toBeUndefined();
      expect(modelFlagForHarness("cursor", "auto")).toBe("auto");
    } finally {
      if (prev === undefined) delete process.env.OPENAI_COMPAT_MODEL;
      else process.env.OPENAI_COMPAT_MODEL = prev;
    }
  });
});

describe("cliSpawnEnv", () => {
  it("strips OPENAI_COMPAT_MODEL and ANTHROPIC_MODEL", () => {
    const prevOpen = process.env.OPENAI_COMPAT_MODEL;
    const prevAnth = process.env.ANTHROPIC_MODEL;
    process.env.OPENAI_COMPAT_MODEL = "glm-5.3-flash";
    process.env.ANTHROPIC_MODEL = "glm-5.3-flash";
    try {
      const env = cliSpawnEnv();
      expect(env.OPENAI_COMPAT_MODEL).toBeUndefined();
      expect(env.ANTHROPIC_MODEL).toBeUndefined();
    } finally {
      if (prevOpen === undefined) delete process.env.OPENAI_COMPAT_MODEL;
      else process.env.OPENAI_COMPAT_MODEL = prevOpen;
      if (prevAnth === undefined) delete process.env.ANTHROPIC_MODEL;
      else process.env.ANTHROPIC_MODEL = prevAnth;
    }
  });
});
