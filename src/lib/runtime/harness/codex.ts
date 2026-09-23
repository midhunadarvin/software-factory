import { startCliSession } from "./cli";
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
  start: async (req: LaneRunRequest): Promise<HarnessSession> => {
    const found = await codexPlugin.detect();
    if (!found.ok) throw new Error(found.error);
    const args = req.resumeSessionId
      ? ["exec", "resume", req.resumeSessionId, "--json"]
      : ["exec", "--json"];
    args.push(req.brief);
    return startCliSession({
      binary: found.binary ?? "codex",
      args,
      req,
      promptArg: true,
    });
  },
};
