import { z } from "zod";
import { defaultHarnessId } from "./detect";
import { HARNESS_IDS, type HarnessConfig, type HarnessId } from "./types";

export const DEFAULT_HARNESS_CONFIG: HarnessConfig = { default: "inprocess", byLane: {} };

const HarnessConfigSchema = z.object({
  default: z.enum(HARNESS_IDS).default("inprocess"),
  byLane: z.record(z.enum(HARNESS_IDS)).default({}),
});

export function defaultHarnessConfig(): HarnessConfig {
  return { default: defaultHarnessId(), byLane: {} };
}

export function parseHarnessConfig(raw: unknown): HarnessConfig {
  if (raw == null || raw === "") return defaultHarnessConfig();
  if (typeof raw === "string" && (HARNESS_IDS as readonly string[]).includes(raw)) {
    return { default: raw as HarnessId, byLane: {} };
  }
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (typeof value === "string" && (HARNESS_IDS as readonly string[]).includes(value)) {
    return { default: value as HarnessId, byLane: {} };
  }
  const parsed = HarnessConfigSchema.safeParse(value);
  return parsed.success ? { default: parsed.data.default, byLane: parsed.data.byLane } : defaultHarnessConfig();
}

export function harnessForLane(config: HarnessConfig, laneId: string): HarnessId {
  return config.byLane[laneId] ?? config.default;
}

export function harnessFromProject(row: { harness?: string | null } | null | undefined): HarnessConfig {
  if (!row?.harness) return defaultHarnessConfig();
  try {
    return parseHarnessConfig(row.harness);
  } catch {
    return defaultHarnessConfig();
  }
}
