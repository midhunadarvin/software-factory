import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { mergeLlmHeaders } from "../runtime/opencode-session";
import type { LlmApiStyle, LlmModelInfo, LlmProviderContext } from "./types";

export function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

export function guardedLlmFetch(style: LlmApiStyle, sessionId?: string): typeof fetch {
  return async (input, init) => {
    const url = requestUrl(input);
    if (style === "chat" && /\/(responses|messages)(\?|$)/.test(url)) {
      throw new Error(
        `Refusing ${url} for a chat-completions model. Use the /v1 root, not a specific endpoint.`,
      );
    }
    if (style === "responses" && /\/(chat\/completions|messages)(\?|$)/.test(url)) {
      throw new Error(`Refusing ${url} for a Responses-API model.`);
    }
    if (style === "messages" && /\/(chat\/completions|responses)(\?|$)/.test(url)) {
      throw new Error(`Refusing ${url} for an Anthropic Messages model.`);
    }
    const existing =
      init?.headers ?? (input instanceof Request ? input.headers : undefined);
    return fetch(input, { ...init, headers: mergeLlmHeaders(url, existing, sessionId) });
  };
}

export function createResponsesModel(modelId: string, ctx: LlmProviderContext): LanguageModel {
  return createOpenAI({
    apiKey: ctx.apiKey,
    baseURL: ctx.baseUrl,
    name: "factory",
    fetch: ctx.fetch,
  }).responses(modelId);
}

export function createChatModel(modelId: string, ctx: LlmProviderContext): LanguageModel {
  return createOpenAICompatible({
    name: "factory",
    apiKey: ctx.apiKey,
    baseURL: ctx.baseUrl,
    supportsStructuredOutputs: true,
    fetch: ctx.fetch,
  })(modelId);
}

export function createMessagesModel(modelId: string, ctx: LlmProviderContext): LanguageModel {
  return createAnthropic({
    apiKey: ctx.apiKey,
    baseURL: ctx.baseUrl,
    fetch: ctx.fetch,
  })(modelId);
}

export function createModelForStyle(
  modelId: string,
  style: LlmApiStyle,
  ctx: LlmProviderContext,
): LanguageModel {
  if (style === "responses") return createResponsesModel(modelId, ctx);
  if (style === "messages") return createMessagesModel(modelId, ctx);
  return createChatModel(modelId, ctx);
}

export async function listOpenAiCompatibleModels(
  ctx: LlmProviderContext,
  apiStyle: (id: string, raw?: { id?: string; name?: string }) => LlmApiStyle,
): Promise<LlmModelInfo[]> {
  const modelsUrl = `${ctx.baseUrl.replace(/\/$/, "")}/models`;
  const res = await ctx.fetch(modelsUrl, {
    headers: mergeLlmHeaders(modelsUrl, { Authorization: `Bearer ${ctx.apiKey}` }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`GET ${modelsUrl} failed (${res.status})`);
  }
  const json = (await res.json()) as { data?: { id?: string; name?: string }[] };
  const seen = new Set<string>();
  const out: LlmModelInfo[] = [];
  for (const row of json.data ?? []) {
    const id = row.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = row.name?.trim();
    out.push({ id, name: name && name !== id ? name : undefined, style: apiStyle(id, row) });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
