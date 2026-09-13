import type { LanguageModel } from "ai";

export type LlmApiStyle = "responses" | "chat" | "messages";

export type LlmResolveEnv = {
  providerId?: string;
  apiKey?: string;
  genericKey?: string;
  xaiKey?: string;
  baseUrl?: string;
};

export type LlmProviderContext = {
  apiKey: string;
  baseUrl: string;
  fetch: typeof fetch;
};

export type LlmModelInfo = {
  id: string;
  name?: string;
  style: LlmApiStyle;
};

export type PublicLlmProvider = {
  id: string;
  label: string;
  description: string;
  defaultBaseUrl: string;
};

/**
 * An LLM backend. Built-ins register at boot.
 * Add another by calling `registerLlmProvider(plugin)` from app startup.
 */
export type LlmProviderPlugin = {
  id: string;
  label: string;
  description: string;
  keyEnvs: string[];
  defaultBaseUrl: string;
  defaultModel: string;
  priority: number;
  match: (env: LlmResolveEnv) => boolean;
  listModels: (ctx: LlmProviderContext) => Promise<LlmModelInfo[]>;
  apiStyle: (modelId: string, meta?: LlmModelInfo) => LlmApiStyle;
  createModel: (modelId: string, ctx: LlmProviderContext) => LanguageModel;
};

export type ResolvedLlmProvider = {
  plugin: LlmProviderPlugin;
  apiKey: string;
  baseUrl: string;
};
