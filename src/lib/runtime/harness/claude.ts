import { startCliSession } from "./cli";
import type { HarnessPlugin, HarnessSession, LaneRunRequest } from "./types";
import { whichBinary } from "./which";

export const claudePlugin: HarnessPlugin = {
  id: "claude",
  label: "Claude Code",
  description: "claude CLI in the job worktree",
  detect: async () => {
    const binary = await whichBinary("claude");
    if (!binary) return { ok: false, error: "claude is not on PATH" };
    return { ok: true, binary };
  },
  start: async (req: LaneRunRequest): Promise<HarnessSession> => {
    const found = await claudePlugin.detect();
    if (!found.ok) throw new Error(found.error);
    const args = ["-p", "--output-format", "stream-json", "--verbose"];
    if (req.write) args.push("--dangerously-skip-permissions");
    if (req.resumeSessionId) args.push("--resume", req.resumeSessionId);
    args.push(req.brief);
    return startCliSession({
      binary: found.binary ?? "claude",
      args,
      req,
      promptArg: true,
    });
  },
};
