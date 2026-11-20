import type { HarnessId } from "./types";
import { getHarness } from "./registry";

/** Preference when no project harness is stored: coding CLIs, then in-process. */
export const CLI_HARNESS_IDS = ["claude", "cursor", "codex"] as const satisfies readonly HarnessId[];

const TTL_MS = 15_000;
let cache: { at: number; ids: HarnessId[] } | null = null;

export function clearHarnessDetectCache() {
  cache = null;
}

export function setHarnessDetectCache(ids: HarnessId[] | null) {
  cache = ids ? { at: Date.now(), ids } : null;
}

export async function detectCliHarnesses(force = false): Promise<HarnessId[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.ids;
  const ids: HarnessId[] = [];
  for (const id of CLI_HARNESS_IDS) {
    const plugin = getHarness(id);
    if (!plugin) continue;
    try {
      const found = await plugin.detect();
      if (found.ok) ids.push(id);
    } catch {
      // ignore a plugin that cannot probe PATH
    }
  }
  cache = { at: Date.now(), ids };
  return ids;
}

export function preferredCliHarness(): HarnessId | null {
  return cache?.ids[0] ?? null;
}

export function defaultHarnessId(): HarnessId {
  return preferredCliHarness() ?? "inprocess";
}
