import { captureCli, parseDashModelList, startCliSession } from "./cli";
import { modelFlagForHarness } from "./model-flag";
import type { HarnessPlugin, HarnessSession, LaneRunRequest } from "./types";
import { whichBinary } from "./which";

export const codexPlugin: HarnessPlugin = {
  id: "codex",
  label: "Codex",
  description: "codex CLI in the job worktree",
  detect: async () => {
    const binary = await whichBinary("codex");
    if (!binary) return { ok: false, error: "codex is not on PATH" };
    return { ok: true, binary };
  },
  listModels: async () => {
    const found = await codexPlugin.detect();
    if (!found.ok) return { models: [] };
    const binary = found.binary ?? "codex";
    for (const args of [["models"], ["--list-models"]] as const) {
      try {
        const out = await captureCli(binary, [...args], { timeoutMs: 15_000 });
        const listed = parseDashModelList(`${out.stdout}\n${out.stderr}`);
        if (listed.models.length) return listed;
      } catch {
        /* try next */
      }
    }
    return { models: [] };
  },
  start: async (req: LaneRunRequest): Promise<HarnessSession> => {
    const found = await codexPlugin.detect();
    if (!found.ok) throw new Error(found.error);
    const args = req.resumeSessionId
      ? ["exec", "resume", req.resumeSessionId, "--json"]
      : ["exec", "--json"];
    const model = modelFlagForHarness("codex", req.model);
    if (model) args.push("--model", model);
    return startCliSession({
      binary: found.binary ?? "codex",
      args,
      req,
      promptArg: true,
    });
  },
};
