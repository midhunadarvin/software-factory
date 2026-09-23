import { z } from "zod";
import { runLaneObjectAgent } from "../lane-agent";
import type { HarnessPlugin, HarnessSession, LaneRunRequest } from "./types";

export const inprocessPlugin: HarnessPlugin = {
  id: "inprocess",
  label: "In-process",
  description: "Factory generateText loop (default). No extra CLI.",
  detect: async () => ({ ok: true }),
  start: async (req: LaneRunRequest): Promise<HarnessSession> => {
    const schema = req.schema ?? z.unknown();
    const result = runLaneObjectAgent({
      lane: req.laneId,
      jobId: req.jobId,
      projectId: req.projectId,
      context: req.context,
      userPrompt: req.userPrompt,
      schema,
      steer: req.steer,
    }).then((artifact) => ({ artifact, text: "", code: 0 as const }));
    return {
      id: `inprocess-${req.jobId}`,
      send: async () => {
        throw new Error("inprocess session is one-shot; start a new run to steer");
      },
      stop: async () => {
        const { stopSession } = await import("../session-store");
        stopSession(req.jobId, "stopped by operator");
      },
      result,
    };
  },
};
