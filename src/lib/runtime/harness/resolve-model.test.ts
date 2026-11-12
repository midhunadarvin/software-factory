import { describe, expect, it } from "vitest";
import { resolveLaneModel } from "./resolve-model";

describe("resolveLaneModel", () => {
  it("keeps a Claude alias", async () => {
    expect(await resolveLaneModel("claude", "sonnet")).toBe("sonnet");
    expect(await resolveLaneModel("claude", "opus")).toBe("opus");
  });

  it("drops an in-process LLM id that Claude cannot run", async () => {
    expect(await resolveLaneModel("claude", "glm-5.3-flash")).toBe("default");
    expect(await resolveLaneModel("claude", null)).toBe("default");
  });

  it("uses the env LLM model for in-process lanes", async () => {
    const prev = process.env.OPENAI_COMPAT_MODEL;
    process.env.OPENAI_COMPAT_MODEL = "glm-5.3-flash";
    try {
      expect(await resolveLaneModel("inprocess", null)).toBe("glm-5.3-flash");
      expect(await resolveLaneModel("inprocess", "custom-id")).toBe("custom-id");
    } finally {
      if (prev === undefined) delete process.env.OPENAI_COMPAT_MODEL;
      else process.env.OPENAI_COMPAT_MODEL = prev;
    }
  });
});
