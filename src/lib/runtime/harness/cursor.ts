import { captureCli, parseDashModelList, startCliSession } from "./cli";
import { modelFlagForHarness } from "./model-flag";
import type { HarnessPlugin, HarnessSession, LaneRunRequest } from "./types";
import { whichBinary } from "./which";

export const cursorPlugin: HarnessPlugin = {
  id: "cursor",
  label: "Cursor Agent",
  description: "cursor-agent CLI in the job worktree",
  detect: async () => {
    const binary = (await whichBinary("cursor-agent")) ?? (await whichBinary("cursor"));
    if (!binary) return { ok: false, error: "cursor-agent is not on PATH" };
    return { ok: true, binary };
  },
  listModels: async () => {
    const found = await cursorPlugin.detect();
    if (!found.ok) return { models: [] };
    try {
      const out = await captureCli(found.binary ?? "cursor-agent", ["--list-models"], { timeoutMs: 20_000 });
      const listed = parseDashModelList(`${out.stdout}\n${out.stderr}`);
      if (listed.models.length) return listed;
    } catch {
      /* fall through */
    }
    return { models: [{ id: "auto", name: "Auto" }], defaultModel: "auto" };
  },
  start: async (req: LaneRunRequest): Promise<HarnessSession> => {
    const found = await cursorPlugin.detect();
    if (!found.ok) throw new Error(found.error);
    const args = ["-p", "--output-format", "stream-json"];
    const model = modelFlagForHarness("cursor", req.model);
    if (model) args.push("--model", model);
    if (req.resumeSessionId) args.push("--resume", req.resumeSessionId);
    return startCliSession({
      binary: found.binary ?? "cursor-agent",
      args,
      req,
      promptArg: true,
    });
  },
};
