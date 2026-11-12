import { startCliSession } from "./cli";
import { CLAUDE_MODEL_ALIASES, modelFlagForHarness } from "./model-flag";
import type { HarnessPlugin, HarnessSession, LaneRunRequest } from "./types";
import { whichBinary } from "./which";

export { CLAUDE_MODEL_ALIASES };

export const claudePlugin: HarnessPlugin = {
  id: "claude",
  label: "Claude Code",
  description: "claude CLI in the job worktree",
  detect: async () => {
    const binary = await whichBinary("claude");
    if (!binary) return { ok: false, error: "claude is not on PATH" };
    return { ok: true, binary };
  },
  listModels: async () => ({
    models: CLAUDE_MODEL_ALIASES.map((m) => ({ id: m.id, name: m.name })),
    defaultModel: "default",
  }),
  start: async (req: LaneRunRequest): Promise<HarnessSession> => {
    const found = await claudePlugin.detect();
    if (!found.ok) throw new Error(found.error);
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
    const model = modelFlagForHarness("claude", req.model);
    if (model) args.push("--model", model);
    args.push("--dangerously-skip-permissions");
    if (req.resumeSessionId) args.push("--resume", req.resumeSessionId);
    return startCliSession({
      binary: found.binary ?? "claude",
      args,
      req,
      promptArg: true,
    });
  },
};
