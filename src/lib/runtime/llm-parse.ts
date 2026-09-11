import { parse as parseYaml } from "yaml";
import type { z } from "zod";

const FENCE_RE = /```(?:json|yaml|yml|javascript)?\s*\r?\n?([\s\S]*?)```/gi;
const OPEN_FENCE_RE = /^```(?:json|yaml|yml|javascript)?\s*\r?\n?([\s\S]*)$/i;

export function recoverStructuredValue(raw: string): unknown | undefined {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) return undefined;

  const candidates: string[] = [];
  for (const match of text.matchAll(FENCE_RE)) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }
  const open = text.match(OPEN_FENCE_RE);
  if (open?.[1]?.trim() && !candidates.includes(open[1].trim())) {
    candidates.push(open[1].trim());
  }
  candidates.push(text);
  const jsonBlock = extractBalanced(text, "{") ?? extractBalanced(text, "[");
  if (jsonBlock && !candidates.includes(jsonBlock)) candidates.push(jsonBlock);

  for (const candidate of candidates) {
    const parsed = tryParseCandidate(candidate);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function parseStructured<S extends z.ZodTypeAny>(
  raw: string,
  schema: S,
): { ok: true; value: z.infer<S> } | { ok: false; error: Error } {
  const value = recoverStructuredValue(raw);
  if (value === undefined) {
    return { ok: false, error: new Error("could not recover JSON or YAML from model output") };
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: parsed.error };
}

export async function repairStructuredText(opts: { text: string; error?: unknown }): Promise<string | null> {
  const value = recoverStructuredValue(opts.text);
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function textFromLlmError(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const rec = err as { text?: unknown; cause?: unknown; message?: string };
  if (typeof rec.text === "string" && rec.text.trim()) return rec.text;
  if (rec.cause) {
    const nested = textFromLlmError(rec.cause);
    if (nested) return nested;
  }
  return "";
}

export function isParseLlmError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as { name?: string; message?: string; cause?: unknown };
  if (rec.name === "AI_NoObjectGeneratedError" || rec.name === "NoObjectGeneratedError") return true;
  if (rec.name === "SyntaxError" || rec.name === "ZodError") return true;
  if (/could not parse|no object generated|unexpected token|JSON/i.test(rec.message ?? "")) return true;
  return rec.cause ? isParseLlmError(rec.cause) : false;
}

export function isRetryableLlmError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as {
    name?: string;
    message?: string;
    statusCode?: number;
    isRetryable?: boolean;
    cause?: unknown;
    errors?: unknown[];
  };
  if (rec.name === "AbortError" || rec.name === "GraphInterrupt") return false;
  const status = rec.statusCode;
  if (status === 401 || status === 403 || status === 404) return false;
  if (rec.isRetryable === true) return true;
  if (status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500)) {
    return true;
  }
  if (rec.name === "AI_RetryError" || rec.name === "RetryError") return true;
  if (isParseLlmError(err)) return true;
  if (
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket|Internal server error|overloaded/i.test(
      rec.message ?? "",
    )
  ) {
    return true;
  }
  if (Array.isArray(rec.errors) && rec.errors.some((e) => isRetryableLlmError(e))) return true;
  return rec.cause ? isRetryableLlmError(rec.cause) : false;
}

export function formatLlmError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err).slice(0, 4000);
  const rec = err as {
    message?: string;
    statusCode?: number;
    responseBody?: string;
    text?: string;
    cause?: unknown;
    lastError?: unknown;
  };
  const parts: string[] = [rec.message ?? String(err)];
  if (rec.statusCode) parts[0] += ` (${rec.statusCode})`;
  if (typeof rec.responseBody === "string" && rec.responseBody.trim()) {
    parts.push(rec.responseBody.slice(0, 400));
  }
  const snippet = rec.text ?? textFromLlmError(rec.cause) ?? textFromLlmError(rec.lastError);
  if (snippet) parts.push(`model output: ${snippet.slice(0, 400)}`);
  return parts.join(" — ").slice(0, 4000);
}

export const DEFAULT_LLM_ATTEMPTS = 3;
export const LLM_BACKOFF_MS = [200, 800, 2000] as const;

export async function withLlmAttempts<T>(opts: {
  operation: (attempt: number) => Promise<T>;
  maxAttempts?: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (attempt: number, err: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
}): Promise<T> {
  const max = opts.maxAttempts ?? DEFAULT_LLM_ATTEMPTS;
  const shouldRetry = opts.shouldRetry ?? isRetryableLlmError;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await opts.operation(attempt);
    } catch (err) {
      last = err;
      if (attempt >= max || !shouldRetry(err, attempt)) throw err;
      opts.onRetry?.(attempt, err);
      const wait = LLM_BACKOFF_MS[Math.min(attempt - 1, LLM_BACKOFF_MS.length - 1)] ?? 200;
      await sleep(wait);
    }
  }
  throw last;
}

function tryParseCandidate(raw: string): unknown | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const jsonish = stripTrailingCommas(trimmed);
  try {
    return JSON.parse(jsonish);
  } catch {
    /* try yaml */
  }
  try {
    const yaml = parseYaml(trimmed);
    if (yaml !== null && typeof yaml === "object") return yaml;
  } catch {
    /* ignore */
  }
  return undefined;
}

function stripTrailingCommas(raw: string): string {
  return raw.replace(/,(\s*[}\]])/g, "$1");
}

function extractBalanced(text: string, open: "{" | "["): string | null {
  const start = text.indexOf(open);
  if (start < 0) return null;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
