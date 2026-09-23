import type { HarnessSession } from "./types";

const live = new Map<string, HarnessSession>();
const lastSessionId = new Map<string, string>();

export function setLiveHarness(jobId: string, session: HarnessSession) {
  live.set(jobId, session);
}

export function liveHarness(jobId: string): HarnessSession | undefined {
  return live.get(jobId);
}

export function clearLiveHarness(jobId: string) {
  live.delete(jobId);
}

export function rememberHarnessSession(jobId: string, sessionId: string | undefined) {
  if (sessionId) lastSessionId.set(jobId, sessionId);
}

export function lastHarnessSession(jobId: string): string | undefined {
  return lastSessionId.get(jobId);
}
