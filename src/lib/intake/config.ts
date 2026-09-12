import { z } from "zod";
import { listIntegrations } from "../integrations/registry";
import type { IntegrationPlugin } from "../integrations/types";
import { type IntakeConfig, pluginSettings } from "./settings";

export type { IntakeConfig } from "./settings";
export { pluginSettings };

function providerSchema(plugin: IntegrationPlugin) {
  const shape: z.ZodRawShape = {
    enabled: z.boolean().default(plugin.defaultEnabled),
  };
  for (const field of plugin.settingsFields) {
    shape[field.key] = z.string().default("");
  }
  return z.object(shape).passthrough().default({});
}

export function buildIntakeConfigSchema() {
  const shape: z.ZodRawShape = {
    autoTriage: z.boolean().default(false),
  };
  for (const plugin of listIntegrations()) {
    shape[plugin.id] = providerSchema(plugin);
  }
  return z.object(shape).passthrough();
}

/** Latest schema from the current plugin registry. */
export function IntakeConfigSchema() {
  return buildIntakeConfigSchema();
}

export function parseIntake(raw: unknown): IntakeConfig {
  if (raw == null || raw === "") return buildIntakeConfigSchema().parse({}) as IntakeConfig;
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  return buildIntakeConfigSchema().parse(value) as IntakeConfig;
}

export function tryParseIntake(raw: unknown): { ok: true; intake: IntakeConfig } | { ok: false; error: string } {
  try {
    return { ok: true, intake: parseIntake(raw) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function intakeFromProject(row: { intake?: string | null } | null | undefined): IntakeConfig {
  if (!row?.intake) return parseIntake({});
  const parsed = tryParseIntake(row.intake);
  return parsed.ok ? parsed.intake : parseIntake({});
}

export const DEFAULT_INTAKE: IntakeConfig = parseIntake({});
