import { emitLive } from "./events";
import { appendSession, type StreamKind } from "./session-store";

export function pushStream(opts: {
  jobId: string;
  projectId: string;
  lane: string;
  kind: StreamKind;
  delta: string;
  tool?: string;
}) {
  if (!opts.delta && !opts.tool) return;
  appendSession(opts.jobId, opts.kind, opts.delta, opts.tool);
  emitLive({
    projectId: opts.projectId,
    jobId: opts.jobId,
    event: "agent.stream",
    payload: {
      lane: opts.lane,
      kind: opts.kind,
      delta: opts.delta,
      tool: opts.tool,
    },
  });
}
