import { llmApiKey, llmBaseUrl, llmConfigured, llmModel } from "../env";
import { mergeLlmHeaders } from "./opencode-session";

export type AgentStatus = {
  ready: boolean;
  configured: boolean;
  connected: boolean;
  model: string;
  baseUrl: string;
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
  const baseUrl = llmBaseUrl().replace(/\/$/, "");
  const model = llmModel();
  const configured = llmConfigured();
  const checkedAt = new Date().toISOString();
  if (!configured) {
    return {
      ready: false,
      configured: false,
      connected: false,
      model,
      baseUrl,
      error:
        "No agent API key. Set XAI_API_KEY (or OPENAI_API_KEY) and optionally OPENAI_COMPAT_BASE_URL / OPENAI_COMPAT_MODEL, then restart the factory. OPENAI_COMPAT_BASE_URL must be the /v1 root (e.g. https://opencode.ai/zen/go/v1), not /chat/completions.",
      checkedAt,
    };
  }
  const key = llmApiKey()!;
  try {
    const modelsUrl = `${baseUrl}/models`;
    const modelsRes = await fetch(modelsUrl, {
      headers: mergeLlmHeaders(modelsUrl, { Authorization: `Bearer ${key}` }),
      signal: AbortSignal.timeout(12_000),
    });
    if (modelsRes.ok) {
      return {
        ready: true,
        configured: true,
        connected: true,
        model,
        baseUrl,
        error: null,
        checkedAt,
      };
    }
    const chatUrl = `${baseUrl}/chat/completions`;
    const chatRes = await fetch(chatUrl, {
      method: "POST",
      headers: mergeLlmHeaders(chatUrl, {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (chatRes.ok || chatRes.status === 400) {
      return {
        ready: true,
        configured: true,
        connected: true,
        model,
        baseUrl,
        error: null,
        checkedAt,
      };
    }
    const body = await chatRes.text().catch(() => "");
    return {
      ready: false,
      configured: true,
      connected: false,
      model,
      baseUrl,
      error: `Agent API rejected the key (${chatRes.status}). Check XAI_API_KEY / OPENAI_API_KEY and ${baseUrl}. ${body.slice(0, 180)}`,
      checkedAt,
    };
  } catch (err) {
    return {
      ready: false,
      configured: true,
      connected: false,
      model,
      baseUrl,
      error: `Cannot reach ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
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
