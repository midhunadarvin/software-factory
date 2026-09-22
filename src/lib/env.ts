import { createHash } from "node:crypto";
import { readLlmResolveEnv } from "./llm/env";
import { resolveLlmProvider } from "./llm/resolve";
import { normalizeLlmBaseUrl } from "./llm/url";

export { normalizeLlmBaseUrl };

export type FactoryKeys = {
  aesPat: Buffer;
  hmacSession: Buffer;
  aesPatOld: Buffer | null;
};

function decodeSecret(raw: string | undefined, name: string): Buffer {
  if (!raw) {
    throw new Error(`${name} is required`);
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  if (raw.startsWith("base64:")) {
    const buf = Buffer.from(raw.slice(7), "base64");
    if (buf.length < 32) {
      throw new Error(`${name} base64 payload must be at least 32 bytes`);
    }
    return buf;
  }
  throw new Error(
    `${name} must be 64 hex characters or a base64: prefix (≥32 decoded bytes)`,
  );
}

let cached: {
  secret: Buffer;
  secretOld: Buffer | null;
  appPassword: string;
  origin: string;
  bindHost: string;
  bindPort: number;
  varMaxGb: number;
} | null = null;

export function loadEnv() {
  if (cached) return cached;
  const secret = decodeSecret(process.env.FACTORY_SECRET, "FACTORY_SECRET");
  const secretOld = process.env.FACTORY_SECRET_OLD
    ? decodeSecret(process.env.FACTORY_SECRET_OLD, "FACTORY_SECRET_OLD")
    : null;
  const appPassword = process.env.FACTORY_APP_PASSWORD;
  if (!appPassword) throw new Error("FACTORY_APP_PASSWORD is required");
  const origin = process.env.FACTORY_ORIGIN ?? "http://localhost:3000";
  const bind = process.env.FACTORY_BIND ?? "127.0.0.1:3000";
  const [bindHost, portStr] = bind.split(":");
  const bindPort = Number(portStr ?? "3000");
  const varMaxGb = Number(process.env.FACTORY_VAR_MAX_GB ?? "20");
  cached = {
    secret,
    secretOld,
    appPassword,
    origin,
    bindHost: bindHost || "127.0.0.1",
    bindPort: Number.isFinite(bindPort) ? bindPort : 3000,
    varMaxGb,
  };
  return cached;
}

export function llmConfigured(): boolean {
  return Boolean(readLlmResolveEnv().apiKey);
}

export function llmBaseUrl(): string {
  const resolved = resolveLlmProvider();
  if (resolved) return resolved.baseUrl;
  const env = readLlmResolveEnv();
  if (env.baseUrl) return env.baseUrl;
  return "https://opencode.ai/zen/go/v1";
}

export function llmModel(): string {
  const override = process.env.OPENAI_COMPAT_MODEL?.trim();
  if (override) return override;
  return resolveLlmProvider()?.plugin.defaultModel ?? "glm-5.3-flash";
}

export function llmApiKey(): string | undefined {
  return resolveLlmProvider()?.apiKey ?? readLlmResolveEnv().apiKey;
}

export function allowedOrigins(): string[] {
  return loadEnv()
    .origin.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function resetEnvCache() {
  cached = null;
}

export { decodeSecret };
