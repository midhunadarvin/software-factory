import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/client";
import { agentEvents } from "../db/schema";
import { redact } from "../obs/redact";
import { nowIso } from "../paths";

export type SsePayload = {
  id: string;
  type: string;
  projectId: string;
  jobId?: string | null;
  data: unknown;
};

class RuntimeBus extends EventEmitter {
  emitEvent(e: SsePayload) {
    this.emit(`project:${e.projectId}`, e);
    this.emit("all", e);
  }
}

export const bus = new RuntimeBus();
bus.setMaxListeners(200);

export async function logEvent(opts: {
  projectId: string;
  jobId?: string | null;
  level?: "debug" | "info" | "warn" | "error";
  event: string;
  payload?: unknown;
}) {
  const id = randomUUID();
  const payload = redact(JSON.stringify(opts.payload ?? {}));
  const db = getDb();
  await db.insert(agentEvents).values({
    id,
    jobId: opts.jobId ?? null,
    projectId: opts.projectId,
    level: opts.level ?? "info",
    event: opts.event,
    payload,
    createdAt: nowIso(),
  });
  bus.emitEvent({
    id,
    type: opts.event,
    projectId: opts.projectId,
    jobId: opts.jobId,
    data: JSON.parse(payload),
  });
  return id;
}
