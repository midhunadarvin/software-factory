import { customPlugin } from "./plugins/custom";
import { openaiPlugin } from "./plugins/openai";
import { opencodeGoPlugin } from "./plugins/opencode-go";
import { xaiPlugin } from "./plugins/xai";
import type { LlmProviderPlugin, PublicLlmProvider } from "./types";

const plugins = new Map<string, LlmProviderPlugin>();

const ID_RE = /^[a-z][a-z0-9_]*$/;

export function normalizeLlmProviderId(id: string): string {
  return id.trim().toLowerCase().replace(/-/g, "_");
}

/** Register an LLM backend. Built-ins load below; add more from app startup. */
export function registerLlmProvider(plugin: LlmProviderPlugin): void {
  const id = normalizeLlmProviderId(plugin.id);
  if (!id || !ID_RE.test(id)) {
    throw new Error(`invalid LLM provider id: ${plugin.id}`);
  }
  plugins.set(id, { ...plugin, id });
}

export function unregisterLlmProvider(id: string): boolean {
  return plugins.delete(normalizeLlmProviderId(id));
}

export function getLlmProvider(id: string): LlmProviderPlugin | undefined {
  return plugins.get(normalizeLlmProviderId(id));
}

export function listLlmProviders(): LlmProviderPlugin[] {
  return [...plugins.values()];
}

export function publicLlmProviders(): PublicLlmProvider[] {
  return listLlmProviders().map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    defaultBaseUrl: p.defaultBaseUrl,
  }));
}

const builtins = [xaiPlugin, openaiPlugin, opencodeGoPlugin, customPlugin];

export function loadBuiltinLlmProviders(): void {
  for (const plugin of builtins) {
    if (!plugins.has(plugin.id)) registerLlmProvider(plugin);
  }
}

loadBuiltinLlmProviders();
