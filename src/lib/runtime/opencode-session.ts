import { randomUUID } from "node:crypto";

export const OPENCODE_SESSION_HEADER = "x-opencode-session";
export const FACTORY_USER_AGENT = "software-factory/0.1.0";

let fallbackSessionId: string | undefined;

/** True for opencode.ai and any subdomain (Go / Zen). */
export function isOpenCodeHost(urlOrHost: string): boolean {
  try {
    const host = urlOrHost.includes("://") ? new URL(urlOrHost).hostname : urlOrHost;
    return host === "opencode.ai" || host.endsWith(".opencode.ai");
  } catch {
    return /(?:^|\.)opencode\.ai$/i.test(urlOrHost);
  }
}

/**
 * Stable per-conversation id for OpenCode Go routing / prompt cache.
 * Job ids are already UUIDs; requests without a job share one process-local id.
 */
export function openCodeSessionId(scope?: string): string {
  const trimmed = scope?.trim();
  if (trimmed) return trimmed;
  fallbackSessionId ??= randomUUID();
  return fallbackSessionId;
}

export function resetOpenCodeSessionFallback() {
  fallbackSessionId = undefined;
}

/** Merge OpenCode affinity headers onto an outbound request. Existing values win. */
export function mergeLlmHeaders(
  url: string,
  headers?: HeadersInit,
  sessionId?: string,
): Headers {
  const next = new Headers(headers);
  if (!isOpenCodeHost(url)) return next;
  if (!next.has(OPENCODE_SESSION_HEADER)) {
    next.set(OPENCODE_SESSION_HEADER, openCodeSessionId(sessionId));
  }
  if (!next.has("user-agent")) {
    next.set("user-agent", FACTORY_USER_AGENT);
  }
  return next;
}
