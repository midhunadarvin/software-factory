import { createModelForStyle, listOpenAiCompatibleModels } from "../sdk";
import type { LlmApiStyle, LlmProviderPlugin } from "../types";

export function customApiStyle(modelId: string): LlmApiStyle {
  const id = modelId.trim().toLowerCase();
  if (/^(grok-|gpt-|o[1-9]|chatgpt-|muse-spark)/.test(id)) return "responses";
  if (/^(minimax-|qwen3[.-])/.test(id)) return "messages";
  return "chat";
}

export const customPlugin: LlmProviderPlugin = {
  id: "custom",
  label: "Custom OpenAI-compatible",
  description: "Any OpenAI-compatible /v1 root via OPENAI_COMPAT_BASE_URL.",
  keyEnvs: ["FACTORY_LLM_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY"],
  defaultBaseUrl: "",
  defaultModel: "gpt-4o",
  priority: 20,
  match: (env) => Boolean(env.baseUrl),
  listModels: (ctx) => listOpenAiCompatibleModels(ctx, (id) => customApiStyle(id)),
  apiStyle: (modelId) => customApiStyle(modelId),
  createModel: (modelId, ctx) => createModelForStyle(modelId, customApiStyle(modelId), ctx),
};
