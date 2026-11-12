import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { sessionFilePath } from "../paths";
import { stepIndex, type RestartStepId } from "./lanes";
import type { ResolvedPipeline } from "./pipeline";

export type StreamKind = "thinking" | "text" | "tool";

export type AgentSession = {
  id: string;
  jobId: string;
  projectId: string;
  lane: string;
  model?: string;
  status: "running" | "done" | "error";
  thinking: string;
  text: string;
  tools: { name: string; detail?: string }[];
  error?: string;
  risk?: "low" | "medium" | "high";
  classification?: "simple" | "complex";
  artifact?: unknown;
  updatedAt: string;
};

export type ChatTurn = {
  role: "user" | "agent";
  lane: string;
  text: string;
  at: string;
};

export type SessionBundle = {
  jobId: string;
  projectId: string;
  current: AgentSession | null;
  history: AgentSession[];
  turns: ChatTurn[];
};

type Store = {
  bundles: Map<string, SessionBundle>;
  persistTimers: Map<string, ReturnType<typeof setTimeout>>;
  aborts: Map<string, AbortController>;
};

function store(): Store {
  const g = globalThis as typeof globalThis & { __factorySessions?: Store };
  if (!g.__factorySessions) {
    g.__factorySessions = { bundles: new Map(), persistTimers: new Map(), aborts: new Map() };
  }
  return g.__factorySessions;
}

function emptyBundle(jobId: string, projectId = ""): SessionBundle {
  return { jobId, projectId, current: null, history: [], turns: [] };
}

function normalizeTurns(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const t = row as Partial<ChatTurn>;
    if (t.role !== "user" && t.role !== "agent") continue;
    if (typeof t.lane !== "string" || typeof t.text !== "string" || typeof t.at !== "string") continue;
    out.push({ role: t.role, lane: t.lane, text: t.text, at: t.at });
  }
  return out;
}

export function getSessionBundle(jobId: string, opts?: { refresh?: boolean }): SessionBundle {
  const mem = store().bundles.get(jobId);
  if (mem && !opts?.refresh) return mem;
  const disk = readSessionBundle(jobId);
  if (mem?.current && disk.current) {
    const newer = disk.current.updatedAt >= mem.current.updatedAt ? disk : mem;
    const memTurns = mem.turns ?? [];
    const diskTurns = disk.turns ?? [];
    const merged: SessionBundle = {
      jobId,
      projectId: newer.projectId || mem.projectId || disk.projectId,
      current: newer.current,
      history: disk.history.length >= mem.history.length ? disk.history : mem.history,
      turns: memTurns.length >= diskTurns.length ? memTurns : diskTurns,
    };
    store().bundles.set(jobId, merged);
    return merged;
  }
  const next = disk.current || disk.history.length ? disk : (mem ?? disk);
  store().bundles.set(jobId, next);
  return next;
}

export function getSession(jobId: string): AgentSession | undefined {
  return getSessionBundle(jobId).current ?? undefined;
}

export function chatTurns(jobId: string): ChatTurn[] {
  return getSessionBundle(jobId).turns ?? [];
}

export function appendChatTurn(jobId: string, turn: ChatTurn): ChatTurn[] {
  const bundle = getSessionBundle(jobId);
  bundle.turns = [...(bundle.turns ?? []), turn];
  store().bundles.set(jobId, bundle);
  persistSession(jobId, true);
  return bundle.turns;
}

export function startSession(
  jobId: string,
  projectId: string,
  lane: string,
  model?: string,
): AgentSession {
  const bundle = getSessionBundle(jobId);
  bundle.projectId = projectId || bundle.projectId;
  if (!bundle.turns) bundle.turns = [];
  if (bundle.current && (bundle.current.thinking || bundle.current.text || bundle.current.status !== "running")) {
    bundle.history.push(bundle.current);
  }
  const s: AgentSession = {
    id: randomUUID(),
    jobId,
    projectId,
    lane,
    model,
    status: "running",
    thinking: "",
    text: "",
    tools: [],
    updatedAt: new Date().toISOString(),
  };
  bundle.current = s;
  store().bundles.set(jobId, bundle);
  const prev = store().aborts.get(jobId);
  prev?.abort();
  store().aborts.set(jobId, new AbortController());
  persistSession(jobId, true);
  return s;
}

export function appendSession(
  jobId: string,
  kind: StreamKind,
  delta: string,
  toolName?: string,
): AgentSession | undefined {
  const s = getSession(jobId);
  if (!s || s.status !== "running") return undefined;
  if (kind === "thinking") s.thinking += delta;
  else if (kind === "text") s.text += delta;
  else if (kind === "tool" && toolName) {
    s.tools.push({ name: toolName, detail: delta || undefined });
  }
  if (s.thinking.length > 80_000) s.thinking = s.thinking.slice(-80_000);
  if (s.text.length > 120_000) s.text = s.text.slice(-120_000);
  s.updatedAt = new Date().toISOString();
  persistSession(jobId, true);
  return s;
}

export function setSessionArtifact(jobId: string, artifact: unknown) {
  const s = getSession(jobId);
  if (!s) return;
  s.artifact = artifact;
  s.updatedAt = new Date().toISOString();
  persistSession(jobId, true);
}

export function getSessionArtifact(jobId: string): unknown {
  return getSession(jobId)?.artifact;
}

export function patchSession(
  jobId: string,
  patch: Partial<Pick<AgentSession, "risk" | "classification" | "error">>,
) {
  const s = getSession(jobId);
  if (!s) return;
  Object.assign(s, patch);
  s.updatedAt = new Date().toISOString();
  persistSession(jobId, true);
}

export function finishSession(jobId: string, status: "done" | "error", error?: string) {
  const s = getSession(jobId);
  if (!s) return;
  s.status = status;
  s.error = error;
  s.updatedAt = new Date().toISOString();
  persistSession(jobId, true);
}

export function abortSession(jobId: string) {
  store().aborts.get(jobId)?.abort();
}

export function stopSession(jobId: string, reason?: string) {
  finishSession(jobId, "done", reason);
  abortSession(jobId);
}

/** Keep sessions from steps before `step`; drop current/history from that step onward. */
export function trimSessionsFromStep(jobId: string, step: RestartStepId, pipeline?: ResolvedPipeline) {
  const bundle = getSessionBundle(jobId, { refresh: true });
  const cut = stepIndex(step, pipeline);
  const keep = (s: AgentSession) => {
    const idx = stepIndex(s.lane, pipeline);
    return idx >= 0 && idx < cut;
  };
  bundle.history = bundle.history.filter(keep);
  if (bundle.current && !keep(bundle.current)) bundle.current = null;
  bundle.turns = (bundle.turns ?? []).filter((t) => {
    const idx = stepIndex(t.lane, pipeline);
    return idx >= 0 && idx < cut;
  });
  store().bundles.set(jobId, bundle);
  persistSession(jobId, true);
}

export function sessionWasStopped(jobId: string): boolean {
  const s = getSession(jobId);
  return Boolean(s && s.status !== "running");
}

export function sessionAbortSignal(jobId: string): AbortSignal | undefined {
  return store().aborts.get(jobId)?.signal;
}

export function readSessionBundle(jobId: string): SessionBundle {
  try {
    const raw = fs.readFileSync(sessionFilePath(jobId), "utf8");
    const parsed = JSON.parse(raw) as SessionBundle & AgentSession;
    if (parsed && Array.isArray(parsed.history) && "current" in parsed) {
      return {
        jobId: parsed.jobId || jobId,
        projectId: parsed.projectId || "",
        current: parsed.current,
        history: parsed.history,
        turns: normalizeTurns((parsed as SessionBundle).turns),
      };
    }
    if (parsed && "status" in parsed && parsed.jobId) {
      const legacy = parsed as unknown as AgentSession;
      if (!legacy.id) legacy.id = randomUUID();
      return { jobId, projectId: legacy.projectId || "", current: legacy, history: [], turns: [] };
    }
  } catch {
    /* missing */
  }
  return emptyBundle(jobId);
}

export function readSessionFile(jobId: string): AgentSession | undefined {
  return readSessionBundle(jobId).current ?? undefined;
}

function persistSession(jobId: string, flush: boolean) {
  const bundle = store().bundles.get(jobId);
  if (!bundle) return;
  const timers = store().persistTimers;
  const write = () => {
    timers.delete(jobId);
    const dest = sessionFilePath(jobId);
    const tmp = `${dest}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(bundle));
    fs.renameSync(tmp, dest);
  };
  if (flush) {
    const pending = timers.get(jobId);
    if (pending) clearTimeout(pending);
    write();
    return;
  }
  if (timers.has(jobId)) return;
  timers.set(jobId, setTimeout(write, 40));
}
