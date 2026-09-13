import { hostMatches } from "../env";
import { createModelForStyle, listOpenAiCompatibleModels } from "../sdk";
import type { LlmApiStyle, LlmProviderPlugin } from "../types";

export function openaiApiStyle(modelId: string): LlmApiStyle {
  const id = modelId.trim().toLowerCase();
  if (/^(gpt-|o[1-9]|chatgpt-|omni-)/.test(id)) return "responses";
  return "chat";
}

export const openaiPlugin: LlmProviderPlugin = {
  id: "openai",
  label: "OpenAI",
  description: "OpenAI API (api.openai.com). Select with LLM_PROVIDER=openai.",
  keyEnvs: ["OPENAI_API_KEY", "FACTORY_LLM_API_KEY"],
  defaultBaseUrl: "https://api.openai.com/v1",
  defaultModel: "gpt-4o",
  priority: 60,
  match: (env) => hostMatches(env.baseUrl, "api.openai.com"),
  listModels: (ctx) => listOpenAiCompatibleModels(ctx, (id) => openaiApiStyle(id)),
  apiStyle: (modelId) => openaiApiStyle(modelId),
  createModel: (modelId, ctx) => createModelForStyle(modelId, openaiApiStyle(modelId), ctx),
};
