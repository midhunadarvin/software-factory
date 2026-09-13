import { hostMatches } from "../env";
import { createModelForStyle, listOpenAiCompatibleModels } from "../sdk";
import type { LlmProviderPlugin } from "../types";

function xaiStyle(): "responses" {
  return "responses";
}

export const xaiPlugin: LlmProviderPlugin = {
  id: "xai",
  label: "xAI",
  description: "xAI Grok via the Responses API at api.x.ai.",
  keyEnvs: ["XAI_API_KEY", "FACTORY_LLM_API_KEY"],
  defaultBaseUrl: "https://api.x.ai/v1",
  defaultModel: "grok-4.5",
  priority: 80,
  match: (env) => {
    if (hostMatches(env.baseUrl, "api.x.ai")) return true;
    if (env.apiKey?.toLowerCase().startsWith("xai-")) return true;
    return Boolean(env.xaiKey);
  },
  listModels: (ctx) => listOpenAiCompatibleModels(ctx, () => xaiStyle()),
  apiStyle: () => xaiStyle(),
  createModel: (modelId, ctx) => createModelForStyle(modelId, xaiStyle(), ctx),
};
