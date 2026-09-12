import { z } from "zod";

export const IntakeConfigSchema = z.object({
  autoTriage: z.boolean().default(false),
  github: z
    .object({
      enabled: z.boolean().default(true),
      /** Empty = ingest every opened issue. Set e.g. "factory" to require that label. */
      label: z.string().default(""),
    })
    .default({}),
  linear: z
    .object({
      enabled: z.boolean().default(false),
      teamId: z.string().default(""),
      label: z.string().default(""),
    })
    .default({}),
  jira: z
    .object({
      enabled: z.boolean().default(false),
      projectKey: z.string().default(""),
      label: z.string().default(""),
    })
    .default({}),
});
export type IntakeConfig = z.infer<typeof IntakeConfigSchema>;

export const DEFAULT_INTAKE: IntakeConfig = IntakeConfigSchema.parse({});

export function parseIntake(raw: unknown): IntakeConfig {
  if (raw == null || raw === "") return DEFAULT_INTAKE;
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  return IntakeConfigSchema.parse(value);
}

export function tryParseIntake(raw: unknown): { ok: true; intake: IntakeConfig } | { ok: false; error: string } {
  try {
    return { ok: true, intake: parseIntake(raw) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function intakeFromProject(row: { intake?: string | null } | null | undefined): IntakeConfig {
  if (!row?.intake) return DEFAULT_INTAKE;
  const parsed = tryParseIntake(row.intake);
  return parsed.ok ? parsed.intake : DEFAULT_INTAKE;
}
