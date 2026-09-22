import {
  Agent,
  BeforeToolCallEvent,
  ModelStreamUpdateEvent,
  type AgentStreamEvent,
} from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import type { z } from "zod";
import { llmApiKey, llmBaseUrl, llmConfigured, llmModel } from "../env";
import { getSqlite } from "../db/client";
import { nowIso } from "../paths";
import type { FactoryToolSet } from "./factory-tool";
import { mergeLlmHeaders } from "./opencode-session";
import { sessionAbortSignal, sessionWasStopped } from "./session-store";
import { toStrandsTools } from "./strands-tools";
import {
  formatLlmError,
  isRetryableLlmError,
  parseStructured,
  repairStructuredText,
  textFromLlmError,
  withLlmAttempts,
} from "./llm-parse";

export {
  formatLlmError,
  isParseLlmError,
  isRetryableLlmError,
  parseStructured,
  recoverStructuredValue,
  repairStructuredText,
  withLlmAttempts,
} from "./llm-parse";

const JSON_ONLY =
  "Respond with a single JSON object that matches the requested schema. Do not wrap it in markdown fences. Do not use YAML. No commentary.";

const jobModels = new Map<string, string>();
let modelListCache: { at: number; ids: string[] } | null = null;

export function clearModelListCache() {
  modelListCache = null;
}

export function getJobModel(jobId: string): string {
  const cached = jobModels.get(jobId);
  if (cached) return cached;
  const fromDb = readStoredJobModel(jobId);
  if (fromDb) {
    jobModels.set(jobId, fromDb);
    return fromDb;
  }
  return llmModel();
}

export function setJobModel(jobId: string, model: string) {
  const id = model.trim();
  if (!id) return;
  jobModels.set(jobId, id);
  try {
    getSqlite()
      .prepare("UPDATE jobs SET model = ?, updated_at = ? WHERE id = ?")
      .run(id, nowIso(), jobId);
  } catch {
    /* tests or pre-migrate */
  }
}

function readStoredJobModel(jobId: string): string | null {
  try {
    const row = getSqlite().prepare("SELECT model FROM jobs WHERE id = ?").get(jobId) as
      | { model?: string | null }
      | undefined;
    const id = row?.model?.trim();
    return id || null;
  } catch {
    return null;
  }
}

function isXaiHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "api.x.ai" || host.endsWith(".x.ai");
  } catch {
    return /(?:^|\.)x\.ai$/i.test(baseUrl);
  }
}

/** Strands OpenAIModel API: Grok / api.x.ai → Responses; OpenCode GLM/Kimi/DeepSeek → Chat Completions. */
export function llmApiStyle(modelId: string, baseUrl = llmBaseUrl()): "responses" | "chat" {
  const id = modelId.trim().toLowerCase();
  if (isXaiHost(baseUrl)) return "responses";
  if (/^(grok-|gpt-|o[1-9]|chatgpt-|muse-spark)/.test(id)) return "responses";
  return "chat";
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function sdkFetch(sessionId?: string): typeof fetch {
  return async (input, init) => {
    const url = requestUrl(input);
    const existing = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    return fetch(input, { ...init, headers: mergeLlmHeaders(url, existing, sessionId) });
  };
}

export function getModel(jobId?: string): OpenAIModel | null {
  const key = llmApiKey();
  if (!key) return null;
  const baseURL = llmBaseUrl();
  const id = jobId ? getJobModel(jobId) : llmModel();
  const api = llmApiStyle(id, baseURL);
  return new OpenAIModel({
    api,
    modelId: id,
    apiKey: key,
    clientConfig: {
      baseURL,
      fetch: sdkFetch(jobId),
    },
    ...(api === "responses" ? { params: { reasoning_effort: "medium" } } : {}),
  });
}

export async function listAvailableModels(): Promise<{
  models: string[];
  defaultModel: string;
}> {
  const defaultModel = llmModel();
  if (modelListCache && Date.now() - modelListCache.at < 60_000) {
    return { models: ensureDefault(modelListCache.ids, defaultModel), defaultModel };
  }
  const key = llmApiKey();
  const base = llmBaseUrl().replace(/\/$/, "");
  if (!key) return { models: [defaultModel], defaultModel };
  try {
    const modelsUrl = `${base}/models`;
    const res = await fetch(modelsUrl, {
      headers: mergeLlmHeaders(modelsUrl, { Authorization: `Bearer ${key}` }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { models: [defaultModel], defaultModel };
    const json = (await res.json()) as { data?: { id?: string }[] };
    const ids = (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id))
      .sort();
    modelListCache = { at: Date.now(), ids };
    return { models: ensureDefault(ids, defaultModel), defaultModel };
  } catch {
    return { models: [defaultModel], defaultModel };
  }
}

function ensureDefault(ids: string[], fallback: string) {
  return ids.includes(fallback) ? ids : [fallback, ...ids];
}

export type LlmStreamPart = {
  type: "thinking" | "text" | "tool";
  delta: string;
  tool?: string;
};

export type LlmStreamChunk = {
  type: string;
  textDelta?: string;
  text?: string;
  delta?: string;
  toolName?: string;
  error?: unknown;
};

export type LlmTextStream = {
  fullStream: AsyncIterable<LlmStreamChunk>;
  text: Promise<string>;
};

export type LlmObjectStream = {
  fullStream: AsyncIterable<LlmStreamChunk>;
  object: Promise<unknown>;
};

export type LlmHooks = {
  streamObject?: (opts: Record<string, unknown>) => LlmObjectStream;
  streamText?: (opts: Record<string, unknown>) => LlmTextStream;
  sleep?: (ms: number) => Promise<void>;
};

export async function completeText(opts: {
  jobId?: string;
  system: string;
  prompt: string;
  tools?: FactoryToolSet;
  maxSteps?: number;
  maxAttempts?: number;
  onPart?: (part: LlmStreamPart) => void;
  hooks?: LlmHooks;
}): Promise<string> {
  requireModel(opts.jobId);
  if (opts.hooks?.streamText) {
    return completeTextViaHook(opts, opts.hooks.streamText);
  }
  return withLlmAttempts({
    maxAttempts: opts.maxAttempts,
    sleep: opts.hooks?.sleep,
    operation: () => runStrands(opts),
  });
}

export async function completeObject<S extends z.ZodTypeAny>(opts: {
  jobId?: string;
  system: string;
  prompt: string;
  schema: S;
  maxAttempts?: number;
  onPart?: (part: LlmStreamPart) => void;
  hooks?: LlmHooks;
}): Promise<z.infer<S>> {
  requireModel(opts.jobId);
  return withLlmAttempts({
    maxAttempts: opts.maxAttempts,
    sleep: opts.hooks?.sleep,
    shouldRetry: (err) => isRetryableLlmError(err),
    operation: async (attempt) => {
      const prompt =
        attempt === 1
          ? opts.prompt
          : `${opts.prompt}\n\nYour previous reply was not valid JSON. ${JSON_ONLY}`;
      const system = `${opts.system}\n\n${JSON_ONLY}`;
      if (opts.hooks?.streamObject && attempt === 1) {
        return await generateObjectOnce({
          jobId: opts.jobId,
          system,
          prompt,
          schema: opts.schema,
          streamObject: opts.hooks.streamObject,
          onPart: opts.onPart,
        });
      }
      if (opts.hooks?.streamText) {
        return await generateObjectViaText({
          system,
          prompt,
          schema: opts.schema,
          streamText: opts.hooks.streamText,
          onPart: opts.onPart,
        });
      }
      const text = await runStrands({
        jobId: opts.jobId,
        system,
        prompt,
        onPart: opts.onPart,
      });
      const recovered = parseStructured(text, opts.schema);
      if (recovered.ok) return recovered.value;
      throw Object.assign(
        new Error(`No object generated: could not parse the response. ${recovered.error.message}`),
        { name: "AI_NoObjectGeneratedError", text, cause: recovered.error },
      );
    },
  });
}

async function completeTextViaHook(
  opts: {
    jobId?: string;
    system: string;
    prompt: string;
    tools?: FactoryToolSet;
    maxSteps?: number;
    maxAttempts?: number;
    onPart?: (part: LlmStreamPart) => void;
    hooks?: LlmHooks;
  },
  streamText: NonNullable<LlmHooks["streamText"]>,
): Promise<string> {
  return withLlmAttempts({
    maxAttempts: opts.maxAttempts,
    sleep: opts.hooks?.sleep,
    operation: async () => {
      const streamed = streamText({
        system: opts.system,
        prompt: opts.prompt,
        tools: opts.tools,
        maxSteps: opts.maxSteps,
      });
      return consumeTextStream(streamed, opts);
    },
  });
}

async function runStrands(opts: {
  jobId?: string;
  system: string;
  prompt: string;
  tools?: FactoryToolSet;
  maxSteps?: number;
  onPart?: (part: LlmStreamPart) => void;
}): Promise<string> {
  const model = requireModel(opts.jobId);
  const agent = new Agent({
    model,
    tools: toStrandsTools(opts.tools),
    systemPrompt: opts.system,
    printer: false,
    retryStrategy: null,
  });
  let raw = "";
  const stream = agent.stream(opts.prompt, {
    limits: opts.maxSteps ? { turns: opts.maxSteps } : undefined,
    cancelSignal: opts.jobId ? sessionAbortSignal(opts.jobId) : undefined,
  });
  try {
    let next = await stream.next();
    while (!next.done) {
      if (opts.jobId && sessionWasStopped(opts.jobId)) {
        agent.cancel();
        return raw.trim();
      }
      emitStreamPart(next.value, opts.onPart, (delta) => {
        raw += delta;
      });
      next = await stream.next();
    }
    return textFromMessage(next.value.lastMessage) || raw.trim();
  } catch (err) {
    if (opts.jobId && sessionWasStopped(opts.jobId)) return raw.trim();
    if (err instanceof Error && (err.name === "AbortError" || err.name === "CancelledError")) {
      return raw.trim();
    }
    throw err;
  }
}

function emitStreamPart(
  event: AgentStreamEvent,
  onPart: ((part: LlmStreamPart) => void) | undefined,
  appendText: (delta: string) => void,
) {
  if (event instanceof ModelStreamUpdateEvent) {
    const inner = event.event;
    if (inner.type === "modelContentBlockDeltaEvent") {
      const delta = inner.delta;
      if (delta.type === "textDelta" && delta.text) {
        appendText(delta.text);
        onPart?.({ type: "text", delta: delta.text });
      } else if (delta.type === "reasoningContentDelta" && delta.text) {
        onPart?.({ type: "thinking", delta: delta.text });
      }
    }
    return;
  }
  if (event instanceof BeforeToolCallEvent && event.toolUse?.name) {
    onPart?.({ type: "tool", delta: "", tool: event.toolUse.name });
  }
}

function textFromMessage(message: { content?: Array<{ type?: string; text?: string }> } | undefined): string {
  if (!message?.content) return "";
  return message.content
    .map((block) => (block.type === "textBlock" && typeof block.text === "string" ? block.text : ""))
    .join("")
    .trim();
}

async function generateObjectOnce<S extends z.ZodTypeAny>(opts: {
  jobId?: string;
  system: string;
  prompt: string;
  schema: S;
  streamObject: NonNullable<LlmHooks["streamObject"]>;
  onPart?: (part: LlmStreamPart) => void;
}): Promise<z.infer<S>> {
  const result = opts.streamObject({
    schema: opts.schema,
    system: opts.system,
    prompt: opts.prompt,
    experimental_repairText: repairStructuredText,
  });
  let raw = "";
  try {
    for await (const part of result.fullStream) {
      if (opts.jobId && sessionWasStopped(opts.jobId)) break;
      if (isReasoningPart(part.type)) {
        const delta = deltaOf(part);
        if (delta) opts.onPart?.({ type: "thinking", delta });
      } else if (part.type === "text-delta") {
        const delta = deltaOf(part);
        if (delta) {
          raw += delta;
          opts.onPart?.({ type: "text", delta });
        }
      } else if (part.type === "error") {
        throw part.error instanceof Error ? part.error : new Error(String(part.error));
      }
    }
    return opts.schema.parse(await result.object);
  } catch (err) {
    void result.object.catch(() => {});
    const text = raw || textFromLlmError(err);
    const recovered = parseStructured(text, opts.schema);
    if (recovered.ok) return recovered.value;
    throw Object.assign(err instanceof Error ? err : new Error(formatLlmError(err)), {
      text: text || undefined,
    });
  }
}

async function generateObjectViaText<S extends z.ZodTypeAny>(opts: {
  system: string;
  prompt: string;
  schema: S;
  streamText: NonNullable<LlmHooks["streamText"]>;
  onPart?: (part: LlmStreamPart) => void;
}): Promise<z.infer<S>> {
  const streamed = opts.streamText({
    system: opts.system,
    prompt: opts.prompt,
  });
  const text = await consumeTextStream(streamed, opts);
  const recovered = parseStructured(text, opts.schema);
  if (recovered.ok) return recovered.value;
  throw Object.assign(new Error(`No object generated: could not parse the response. ${recovered.error.message}`), {
    name: "AI_NoObjectGeneratedError",
    text,
    cause: recovered.error,
  });
}

async function consumeTextStream(
  streamed: LlmTextStream,
  opts: { jobId?: string; onPart?: (part: LlmStreamPart) => void },
): Promise<string> {
  let raw = "";
  try {
    for await (const part of streamed.fullStream) {
      if (opts.jobId && sessionWasStopped(opts.jobId)) {
        return raw.trim();
      }
      if (isReasoningPart(part.type)) {
        const delta = deltaOf(part);
        if (delta) opts.onPart?.({ type: "thinking", delta });
      } else if (part.type === "text-delta") {
        const delta = deltaOf(part);
        if (delta) {
          raw += delta;
          opts.onPart?.({ type: "text", delta });
        }
      } else if (part.type === "tool-call") {
        opts.onPart?.({ type: "tool", delta: "", tool: part.toolName });
      } else if (part.type === "error") {
        throw part.error instanceof Error ? part.error : new Error(String(part.error));
      }
    }
    return (await streamed.text).trim() || raw.trim();
  } catch (err) {
    void streamed.text.catch(() => {});
    if (opts.jobId && sessionWasStopped(opts.jobId)) return raw.trim();
    if (err instanceof Error && err.name === "AbortError") return raw.trim();
    throw err;
  }
}

function requireModel(jobId?: string): OpenAIModel {
  const model = getModel(jobId);
  if (!model) throw new Error("Agent model is not configured");
  return model;
}

function isReasoningPart(type: string): boolean {
  return type === "reasoning-delta" || type === "reasoning" || type === "reasoning-start";
}

export function deltaOf(part: unknown): string {
  if (!part || typeof part !== "object") return "";
  const o = part as Record<string, unknown>;
  for (const key of ["delta", "text", "textDelta", "reasoning"] as const) {
    const v = o[key];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

export { llmConfigured };
