import { describe, expect, it } from "vitest";
import { openCodeGoApiStyle } from "./opencode-go";
import { openaiApiStyle } from "./openai";

describe("openCodeGoApiStyle", () => {
  it("uses chat completions for GLM, Kimi, and DeepSeek", () => {
    expect(openCodeGoApiStyle("glm-5.3-flash")).toBe("chat");
    expect(openCodeGoApiStyle("kimi-k2.6")).toBe("chat");
    expect(openCodeGoApiStyle("deepseek-v4-pro")).toBe("chat");
  });

  it("uses Responses for Grok, GPT, and Muse Spark", () => {
    expect(openCodeGoApiStyle("grok-4.6")).toBe("responses");
    expect(openCodeGoApiStyle("gpt-5.6-luna")).toBe("responses");
    expect(openCodeGoApiStyle("muse-spark-1.3-contributor")).toBe("responses");
  });

  it("uses Anthropic Messages for Qwen and MiniMax", () => {
    expect(openCodeGoApiStyle("qwen3.7-plus")).toBe("messages");
    expect(openCodeGoApiStyle("minimax-m2.7")).toBe("messages");
  });
});

describe("openaiApiStyle", () => {
  it("uses Responses for GPT ids", () => {
    expect(openaiApiStyle("gpt-4o")).toBe("responses");
  });
});
