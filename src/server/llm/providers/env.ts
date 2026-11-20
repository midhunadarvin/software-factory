import { normalizeLlmBaseUrl } from "./url";

export function hostnameOf(url?: string): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    const host = new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase();
    return host || undefined;
  } catch {
    return undefined;
  }
}

export function hostMatches(url: string | undefined, root: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  return host === root || host.endsWith(`.${root}`);
}

export function readLlmResolveEnv(): import("./types").LlmResolveEnv {
  const factory = trimEnv("FACTORY_LLM_API_KEY");
  const opencode = trimEnv("OPENCODE_API_KEY");
  const openai = trimEnv("OPENAI_API_KEY");
  const xai = trimEnv("XAI_API_KEY");
  const generic = factory || opencode || openai || undefined;
  const rawBase = trimEnv("OPENAI_COMPAT_BASE_URL");
  return {
    providerId: trimEnv("LLM_PROVIDER"),
    apiKey: generic || xai || undefined,
    genericKey: generic,
    xaiKey: xai || undefined,
    baseUrl: rawBase ? normalizeLlmBaseUrl(rawBase) : undefined,
  };
}

function trimEnv(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}
