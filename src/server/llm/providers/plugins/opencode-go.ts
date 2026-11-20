import { hostMatches } from "../env";
import { createModelForStyle, listOpenAiCompatibleModels } from "../sdk";
import type { LlmApiStyle, LlmProviderPlugin } from "../types";

export function openCodeGoApiStyle(modelId: string): LlmApiStyle {
  const id = modelId.trim().toLowerCase();
  if (/^(grok-|gpt-|o[1-9]|chatgpt-|muse-spark)/.test(id)) return "responses";
  if (/^(minimax-|qwen3[.-])/.test(id)) return "messages";
  return "chat";
}

export const opencodeGoPlugin: LlmProviderPlugin = {
  id: "opencode_go",
  label: "OpenCode Go",
  description: "OpenCode Zen Go gateway. One key lists GLM, Kimi, Grok, GPT, Qwen, MiniMax, and more.",
  keyEnvs: ["FACTORY_LLM_API_KEY", "OPENCODE_API_KEY", "OPENAI_API_KEY"],
  defaultBaseUrl: "https://opencode.ai/zen/go/v1",
  defaultModel: "glm-5.3-flash",
  priority: 40,
  match: (env) => {
    if (hostMatches(env.baseUrl, "opencode.ai")) return true;
    if (env.baseUrl) return false;
    if (env.xaiKey && !env.genericKey) return false;
    return Boolean(env.genericKey || env.apiKey);
  },
  listModels: (ctx) => listOpenAiCompatibleModels(ctx, (id) => openCodeGoApiStyle(id)),
  apiStyle: (modelId) => openCodeGoApiStyle(modelId),
  createModel: (modelId, ctx) => createModelForStyle(modelId, openCodeGoApiStyle(modelId), ctx),
};
