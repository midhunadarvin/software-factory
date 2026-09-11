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

function getBus(): RuntimeBus {
  const g = globalThis as typeof globalThis & { __factoryBus?: RuntimeBus };
  if (!g.__factoryBus) {
    const created = new RuntimeBus();
    created.setMaxListeners(200);
    g.__factoryBus = created;
  }
  return g.__factoryBus;
}

export const bus = getBus();

/** Live token/thinking — not written to SQLite. */
export function emitLive(opts: {
  projectId: string;
  jobId: string;
  event: string;
  payload?: unknown;
}) {
  const e: SsePayload = {
    id: randomUUID(),
    type: opts.event,
    projectId: opts.projectId,
    jobId: opts.jobId,
    data: { jobId: opts.jobId, ...(opts.payload as object) },
  };
  bus.emitEvent(e);
  mirrorWorkerEvent(e);
}

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
  const e: SsePayload = {
    id,
    type: opts.event,
    projectId: opts.projectId,
    jobId: opts.jobId,
    data: JSON.parse(payload),
  };
  bus.emitEvent(e);
  mirrorWorkerEvent(e);
  return id;
}

function mirrorWorkerEvent(e: SsePayload) {
  if (process.env.FACTORY_WORKER !== "1") return;
  process.stdout.write(`FACTORY_SSE ${JSON.stringify(e)}\n`);
}

export function ingestWorkerLine(line: string): boolean {
  if (!line.startsWith("FACTORY_SSE ")) return false;
  try {
    const e = JSON.parse(line.slice("FACTORY_SSE ".length)) as SsePayload;
    if (e?.type && e.projectId) bus.emitEvent(e);
    return true;
  } catch {
    return false;
  }
}
