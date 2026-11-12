import { llmModel } from "../../env";
import type { HarnessId } from "./types";

export const CLAUDE_MODEL_ALIASES = [
  { id: "default", name: "Default (account)" },
  { id: "sonnet", name: "Sonnet" },
  { id: "opus", name: "Opus" },
  { id: "haiku", name: "Haiku" },
  { id: "fable", name: "Fable" },
  { id: "best", name: "Best" },
] as const;

const CLI_STRIP_ENV = [
  "OPENAI_COMPAT_MODEL",
  "OPENAI_COMPAT_BASE_URL",
  "ANTHROPIC_MODEL",
  "CLAUDE_CODE_AUTO_MODE_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL",
  "CLAUDE_CODE_BG_CLASSIFIER_MODEL",
];

/** Env for a coding CLI. Drops in-process LLM model ids Claude would treat as --model. */
export function cliSpawnEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  for (const key of CLI_STRIP_ENV) delete env[key];
  return env;
}

/**
 * `--model` value a CLI harness may receive. `glm-5.3-flash` and other
 * in-process ids are never forwarded to Claude/Cursor/Codex.
 */
export function modelFlagForHarness(
  harnessId: HarnessId,
  requested?: string | null,
): string | undefined {
  const id = requested?.trim();
  if (!id) return undefined;
  if (harnessId === "inprocess") return id;
  if (harnessId === "claude") {
    if (CLAUDE_MODEL_ALIASES.some((row) => row.id === id)) return id === "default" ? undefined : id;
    if (/^claude[-.]/i.test(id)) return id;
    return undefined;
  }
  if (id === llmModel() || /^glm-/i.test(id)) return undefined;
  return id;
}
