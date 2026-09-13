import { readLlmResolveEnv } from "./env";
import { getLlmProvider, listLlmProviders, normalizeLlmProviderId } from "./registry";
import type { LlmProviderPlugin, LlmResolveEnv, ResolvedLlmProvider } from "./types";

const DEFAULT_PROVIDER_ID = "opencode_go";

export function pickLlmPlugin(env: LlmResolveEnv = readLlmResolveEnv()): LlmProviderPlugin | undefined {
  if (env.providerId) {
    const id = normalizeLlmProviderId(env.providerId);
    const plugin = getLlmProvider(id);
    if (!plugin) {
      const known = listLlmProviders()
        .map((p) => p.id)
        .join(", ");
      throw new Error(`Unknown LLM_PROVIDER=${env.providerId}. Registered: ${known || "(none)"}`);
    }
    return plugin;
  }
  const matched = listLlmProviders().filter((p) => p.match(env));
  if (matched.length > 0) {
    return matched.sort((a, b) => b.priority - a.priority)[0];
  }
  if (env.apiKey) return getLlmProvider(DEFAULT_PROVIDER_ID);
  return undefined;
}

function pluginApiKey(plugin: LlmProviderPlugin, env: LlmResolveEnv): string | undefined {
  for (const name of plugin.keyEnvs) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return env.apiKey;
}

export function resolveLlmProvider(env: LlmResolveEnv = readLlmResolveEnv()): ResolvedLlmProvider | null {
  const plugin = pickLlmPlugin(env);
  if (!plugin) return null;
  const apiKey = pluginApiKey(plugin, env);
  if (!apiKey) return null;
  const baseUrl = (env.baseUrl || plugin.defaultBaseUrl).replace(/\/$/, "");
  if (!baseUrl) return null;
  return { plugin, apiKey, baseUrl };
}
