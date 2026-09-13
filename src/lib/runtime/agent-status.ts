import { llmConfigured, llmModel } from "../env";
import { readLlmResolveEnv } from "../llm/env";
import { resolveLlmProvider } from "../llm/resolve";
import { guardedLlmFetch } from "../llm/sdk";

export type AgentStatus = {
  ready: boolean;
  configured: boolean;
  connected: boolean;
  model: string;
  baseUrl: string;
  provider: string | null;
  error: string | null;
  checkedAt: string;
};

let cache: { at: number; status: AgentStatus } | null = null;
const TTL_MS = 15_000;

export function clearAgentStatusCache() {
  cache = null;
}

export async function getAgentStatus(force = false): Promise<AgentStatus> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.status;
  const status = await probeAgent();
  cache = { at: Date.now(), status };
  return status;
}

export async function probeAgent(): Promise<AgentStatus> {
  const env = readLlmResolveEnv();
  const resolved = resolveLlmProvider();
  const model = llmModel();
  const configured = llmConfigured();
  const checkedAt = new Date().toISOString();
  const baseUrl = resolved?.baseUrl ?? env.baseUrl ?? "https://opencode.ai/zen/go/v1";
  const provider = resolved?.plugin.id ?? null;
  if (!configured) {
    return {
      ready: false,
      configured: false,
      connected: false,
      model,
      baseUrl,
      provider,
      error:
        "No agent API key. Set FACTORY_LLM_API_KEY (OpenCode Go by default) or XAI_API_KEY, then restart the factory. Optional: LLM_PROVIDER=opencode_go|xai|openai|custom and OPENAI_COMPAT_BASE_URL for a custom /v1 root.",
      checkedAt,
    };
  }
  if (!resolved) {
    return {
      ready: false,
      configured: true,
      connected: false,
      model,
      baseUrl,
      provider,
      error: "LLM provider could not be resolved. Set LLM_PROVIDER to a registered plugin id.",
      checkedAt,
    };
  }
  try {
    await resolved.plugin.listModels({
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      fetch: guardedLlmFetch("chat"),
    });
    return {
      ready: true,
      configured: true,
      connected: true,
      model,
      baseUrl: resolved.baseUrl,
      provider: resolved.plugin.id,
      error: null,
      checkedAt,
    };
  } catch (err) {
    return {
      ready: false,
      configured: true,
      connected: false,
      model,
      baseUrl: resolved.baseUrl,
      provider: resolved.plugin.id,
      error: `Cannot reach ${resolved.plugin.label} at ${resolved.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      checkedAt,
    };
  }
}

export async function assertAgentReady(): Promise<AgentStatus> {
  const status = await getAgentStatus();
  if (!status.ready) {
    const error = new Error(status.error ?? "Agent is not configured");
    (error as Error & { code: string }).code = "AGENT_NOT_READY";
    throw error;
  }
  return status;
}
