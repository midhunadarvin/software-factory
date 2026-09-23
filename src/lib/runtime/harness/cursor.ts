import { startCliSession } from "./cli";
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
  start: async (req: LaneRunRequest): Promise<HarnessSession> => {
    const found = await cursorPlugin.detect();
    if (!found.ok) throw new Error(found.error);
    const args = ["-p", "--output-format", "stream-json"];
    if (req.resumeSessionId) args.push("--resume", req.resumeSessionId);
    args.push(req.brief);
    return startCliSession({
      binary: found.binary ?? "cursor-agent",
      args,
      req,
      promptArg: true,
    });
  },
};
