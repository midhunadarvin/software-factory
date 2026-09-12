import type { ProviderSettings } from "../integrations/types";

export type IntakeConfig = {
  autoTriage: boolean;
  [pluginId: string]: unknown;
};

export function pluginSettings(intake: IntakeConfig, id: string): ProviderSettings {
  const raw = intake[id];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    return {
      ...obj,
      enabled: Boolean(obj.enabled),
    };
  }
  return { enabled: false };
}
