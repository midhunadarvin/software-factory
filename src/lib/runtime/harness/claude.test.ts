import { describe, expect, it } from "vitest";
import { claudePlugin } from "./claude";
import { CLAUDE_MODEL_ALIASES } from "./model-flag";

describe("claudePlugin.listModels", () => {
  it("returns Claude Code --model aliases", async () => {
    const listed = await claudePlugin.listModels?.();
    expect(listed?.defaultModel).toBe("default");
    expect(listed?.models.map((m) => m.id)).toEqual([...CLAUDE_MODEL_ALIASES].map((m) => m.id));
  });
});
