import {
  streamObject,
  streamText,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
} from "ai";
import type { z } from "zod";
import { llmConfigured, llmModel } from "../../utils/env";
import { getStore } from "../data";
import { nowIso } from "../../utils/paths";
import { readLlmResolveEnv } from "./providers/env";
import { pickLlmPlugin, resolveLlmProvider } from "./providers/resolve";
import { guardedLlmFetch } from "./providers/sdk";
import type { LlmApiStyle, LlmModelInfo, PublicLlmProvider } from "./providers/types";
import { normalizeLlmBaseUrl } from "./providers/url";
import { sessionAbortSignal, sessionWasStopped } from "../agents/session-store";
import {
  formatLlmError,
  isRetryableLlmError,
  parseStructured,
  repairStructuredText,
  textFromLlmError,
  withLlmAttempts,
} from "./parse";

export {
  formatLlmError,
  isParseLlmError,
  isRetryableLlmError,
  parseStructured,
  recoverStructuredValue,
  repairStructuredText,
  stripErrorStack,
  withLlmAttempts,
} from "./parse";

const JSON_ONLY =
  "Respond with a single JSON object that matches the requested schema. Do not wrap it in markdown fences. Do not use YAML. No commentary.";

const jobModels = new Map<string, string>();
let modelListCache: {
  at: number;
  models: LlmModelInfo[];
  defaultModel: string;
  provider: PublicLlmProvider;
} | null = null;

export function clearModelListCache() {
  modelListCache = null;
}

export async function getStoredJobModel(jobId: string): Promise<string | null> {
  const cached = jobModels.get(jobId);
  if (cached) return cached;
  try {
    const job = await getStore().jobs.get(jobId);
    return job?.model?.trim() || null;
  } catch {
    return null;
  }
}

export async function getJobModel(jobId: string): Promise<string> {
  return (await getStoredJobModel(jobId)) ?? llmModel();
}

export async function setJobModel(jobId: string, model: string): Promise<void> {
  const id = model.trim();
  if (!id) return;
  jobModels.set(jobId, id);
  try {
    await getStore().jobs.update(jobId, { model: id, updatedAt: nowIso() });
  } catch {
    /* tests or pre-migrate */
  }
}

function modelIdFor(jobId?: string): Promise<string> | string {
  return jobId ? getJobModel(jobId) : llmModel();
}

/**
 * API dialect for a model id, from the resolved (or hostname-matched) provider plugin.
 */
export function llmApiStyle(modelId: string, baseUrl?: string): LlmApiStyle {
  const env = readLlmResolveEnv();
  if (baseUrl) env.baseUrl = normalizeLlmBaseUrl(baseUrl);
  const plugin = pickLlmPlugin({ ...env, apiKey: env.apiKey ?? "probe" });
  return plugin?.apiStyle(modelId) ?? "chat";
}

export async function getModel(jobId?: string): Promise<LanguageModel | null> {
  return createModel(await modelIdFor(jobId), jobId);
}

function createModel(id: string, jobId?: string): LanguageModel | null {
  const resolved = resolveLlmProvider();
  if (!resolved) return null;
  const style = resolved.plugin.apiStyle(id);
  return resolved.plugin.createModel(id, {
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
    fetch: guardedLlmFetch(style, jobId),
  });
}

export async function listAvailableModels(): Promise<{
  provider: PublicLlmProvider | null;
  models: LlmModelInfo[];
  defaultModel: string;
}> {
  const resolved = resolveLlmProvider();
  const defaultModel = llmModel();
  if (modelListCache && Date.now() - modelListCache.at < 60_000) {
    return {
      provider: modelListCache.provider,
      models: ensureDefaultModels(modelListCache.models, defaultModel, resolved?.plugin.apiStyle ?? (() => "chat")),
      defaultModel,
    };
  }
  if (!resolved) {
    return { provider: null, models: [{ id: defaultModel, style: "chat" }], defaultModel };
  }
  const provider: PublicLlmProvider = {
    id: resolved.plugin.id,
    label: resolved.plugin.label,
    description: resolved.plugin.description,
    defaultBaseUrl: resolved.baseUrl,
  };
  try {
    const models = await resolved.plugin.listModels({
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      fetch: guardedLlmFetch("chat"),
    });
    const withDefault = ensureDefaultModels(models, defaultModel, (id) => resolved.plugin.apiStyle(id));
    modelListCache = { at: Date.now(), models: withDefault, defaultModel, provider };
    return { provider, models: withDefault, defaultModel };
  } catch {
    const fallback = [{ id: defaultModel, style: resolved.plugin.apiStyle(defaultModel) }];
    return { provider, models: fallback, defaultModel };
  }
}

function ensureDefaultModels(
  models: LlmModelInfo[],
  fallback: string,
  styleOf: (id: string) => LlmApiStyle,
): LlmModelInfo[] {
  if (models.some((m) => m.id === fallback)) return models;
  return [{ id: fallback, style: styleOf(fallback) }, ...models];
}

export type LlmStreamPart = {
  type: "thinking" | "text" | "tool";
  delta: string;
  tool?: string;
};

export type LlmHooks = {
  streamObject?: typeof streamObject;
  streamText?: typeof streamText;
  sleep?: (ms: number) => Promise<void>;
};

export async function completeText<TOOLS extends ToolSet>(opts: {
  jobId?: string;
  system: string;
  prompt: string;
  tools?: TOOLS;
  maxSteps?: number;
  maxAttempts?: number;
  onPart?: (part: LlmStreamPart) => void;
  hooks?: LlmHooks;
}): Promise<string> {
  const modelId = await modelIdFor(opts.jobId);
  const model = requireModel(modelId, opts.jobId);
  const run = opts.hooks?.streamText ?? streamText;
  return withLlmAttempts({
    maxAttempts: opts.maxAttempts,
    sleep: opts.hooks?.sleep,
    operation: async () => {
      const streamed = run({
        model,
        system: opts.system,
        prompt: opts.prompt,
        tools: opts.tools,
        stopWhen: opts.maxSteps ? stepCountIs(opts.maxSteps) : undefined,
        maxRetries: 0,
        abortSignal: opts.jobId ? sessionAbortSignal(opts.jobId) : undefined,
        providerOptions: reasoningProviderOptions(modelId),
      });
      let raw = "";
      let thinking = "";
      try {
        for await (const part of streamed.fullStream) {
          if (opts.jobId && sessionWasStopped(opts.jobId)) {
            return raw.trim();
          }
          if (isReasoningPart(part.type)) {
            const delta = deltaOf(part);
            if (delta) {
              thinking += delta;
              opts.onPart?.({ type: "thinking", delta });
            }
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
        const leftover = await Promise.resolve(streamed.reasoningText).then(
          (v) => v,
          () => undefined,
        );
        if (leftover && leftover.length > thinking.length) {
          opts.onPart?.({ type: "thinking", delta: leftover.slice(thinking.length) });
        }
        return (await streamed.text).trim() || raw.trim();
      } catch (err) {
        void streamed.text.catch(() => {});
        if (opts.jobId && sessionWasStopped(opts.jobId)) return raw.trim();
        if (err instanceof Error && err.name === "AbortError") return raw.trim();
        throw err;
      }
    },
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
  const modelId = await modelIdFor(opts.jobId);
  const model = requireModel(modelId, opts.jobId);
  const objectFn = opts.hooks?.streamObject ?? streamObject;
  const textFn = opts.hooks?.streamText ?? streamText;
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
      if (attempt === 1) {
        return await generateObjectOnce({
          jobId: opts.jobId,
          model,
          modelId,
          system,
          prompt,
          schema: opts.schema,
          streamObject: objectFn,
          onPart: opts.onPart,
        });
      }
      return await generateObjectViaText({
        model,
        system,
        prompt,
        schema: opts.schema,
        streamText: textFn,
        onPart: opts.onPart,
      });
    },
  });
}

async function generateObjectOnce<S extends z.ZodTypeAny>(opts: {
  jobId?: string;
  model: LanguageModel;
  modelId: string;
  system: string;
  prompt: string;
  schema: S;
  streamObject: typeof streamObject;
  onPart?: (part: LlmStreamPart) => void;
}): Promise<z.infer<S>> {
  const result = opts.streamObject({
    model: opts.model,
    schema: opts.schema,
    system: opts.system,
    prompt: opts.prompt,
    maxRetries: 0,
    abortSignal:
      opts.jobId && !sessionWasStopped(opts.jobId) ? sessionAbortSignal(opts.jobId) : undefined,
    experimental_repairText: repairStructuredText,
    providerOptions: reasoningProviderOptions(opts.modelId),
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
  model: LanguageModel;
  system: string;
  prompt: string;
  schema: S;
  streamText: typeof streamText;
  onPart?: (part: LlmStreamPart) => void;
}): Promise<z.infer<S>> {
  const streamed = opts.streamText({
    model: opts.model,
    system: opts.system,
    prompt: opts.prompt,
    maxRetries: 0,
    providerOptions: reasoningProviderOptions(),
  });
  let raw = "";
  for await (const part of streamed.fullStream) {
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
  const text = (await streamed.text.catch(() => "")).trim() || raw.trim();
  const recovered = parseStructured(text, opts.schema);
  if (recovered.ok) return recovered.value;
  throw Object.assign(new Error(`No object generated: could not parse the response. ${recovered.error.message}`), {
    name: "AI_NoObjectGeneratedError",
    text,
    cause: recovered.error,
  });
}

function requireModel(modelId: string, jobId?: string): LanguageModel {
  const model = createModel(modelId, jobId);
  if (!model) throw new Error("Agent model is not configured");
  return model;
}

function reasoningProviderOptions(id: string = llmModel()) {
  if (llmApiStyle(id) !== "responses") return undefined;
  const openai = { reasoningEffort: "medium", reasoningSummary: "detailed" };
  return { openai, factory: openai };
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
