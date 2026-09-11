"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, RotateCcw } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { AgentGate } from "@/components/AgentGate";
import { AppHeader } from "@/components/AppChrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { AgentRunControls } from "@/components/AgentRunControls";

type Live = {
  lane: string;
  model?: string;
  status: "running" | "done" | "error" | "idle";
  thinking: string;
  text: string;
  tools: { name: string; detail?: string }[];
  error?: string;
  risk?: string;
  classification?: string;
};

type DebugEvent = {
  id: string;
  level: string;
  event: string;
  payload: string;
  createdAt: string;
};

function applySnapshot(data: {
  lane?: string;
  model?: string;
  status?: Live["status"] | "idle";
  thinking?: string;
  text?: string;
  tools?: Live["tools"];
  error?: string;
  risk?: string;
  classification?: string;
}): Live {
  return {
    lane: data.lane ?? "",
    model: data.model,
    status: data.status === "idle" || !data.status ? "idle" : data.status,
    thinking: data.thinking ?? "",
    text: data.text ?? "",
    tools: data.tools ?? [],
    error: data.error,
    risk: data.risk,
    classification: data.classification,
  };
}

function Collapse({
  title,
  hint,
  defaultOpen,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-border bg-muted/30" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="font-medium">{title}</span>
        {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      </summary>
      <div className="border-t border-border px-3 py-2">{children}</div>
    </details>
  );
}

function SessionInner() {
  const { id } = useParams<{ id: string }>();
  const queryProject = useSearchParams().get("project") ?? "";
  const router = useRouter();
  const job = trpc.jobs.get.useQuery({ id }, { refetchInterval: 2500 });
  const projectId = queryProject || job.data?.projectId || "";
  const initial = trpc.jobs.session.useQuery({ id }, { refetchInterval: 500 });
  const catalog = trpc.agent.models.useQuery();
  const setModel = trpc.jobs.setModel.useMutation();
  const retry = trpc.jobs.retrySession.useMutation();
  const [live, setLive] = useState<Live>({
    lane: "",
    status: "idle",
    thinking: "",
    text: "",
    tools: [],
  });
  const [model, setModelLocal] = useState("");
  const [sseState, setSseState] = useState<"off" | "live" | "error">("off");
  const textRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!initial.data) return;
    setLive((prev) => {
      const next = applySnapshot(initial.data);
      const incomingLen = (next.thinking?.length ?? 0) + (next.text?.length ?? 0);
      const prevLen = prev.thinking.length + prev.text.length;
      if (prev.status === "running" && incomingLen < prevLen) {
        return { ...next, thinking: prev.thinking, text: prev.text, tools: prev.tools.length ? prev.tools : next.tools };
      }
      return next;
    });
    if (initial.data.model) setModelLocal(initial.data.model);
  }, [initial.data]);

  useEffect(() => {
    if (!model && catalog.data?.defaultModel) setModelLocal(catalog.data.defaultModel);
  }, [catalog.data, model]);

  useEffect(() => {
    if (!projectId) return;
    const es = new EventSource(`/api/events?projectId=${encodeURIComponent(projectId)}&jobId=${encodeURIComponent(id)}`);
    es.onopen = () => setSseState("live");
    es.onerror = () => setSseState("error");
    const onSnapshot = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data) as Live & { jobId?: string };
      if (data.jobId && data.jobId !== id) return;
      setLive(applySnapshot(data));
    };
    es.addEventListener("agent.session", onSnapshot);
    es.addEventListener("agent.stream", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as {
        jobId?: string;
        lane?: string;
        kind?: string;
        delta?: string;
        tool?: string;
      };
      if (data.jobId && data.jobId !== id) return;
      setLive((prev) => {
        const next = { ...prev, status: "running" as const, lane: data.lane ?? prev.lane };
        if (data.kind === "thinking") next.thinking = prev.thinking + (data.delta ?? "");
        if (data.kind === "text") next.text = prev.text + (data.delta ?? "");
        if (data.kind === "tool" && data.tool) {
          next.tools = [...prev.tools, { name: data.tool, detail: data.delta }];
        }
        return next;
      });
    });
    es.addEventListener("lane.agent.start", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as {
        jobId?: string;
        lane?: string;
        model?: string;
      };
      if (data.jobId && data.jobId !== id) return;
      setLive({
        lane: data.lane ?? "",
        model: data.model,
        status: "running",
        thinking: "",
        text: "",
        tools: [],
      });
      if (data.model) setModelLocal(data.model);
      void initial.refetch();
    });
    es.addEventListener("lane.agent.end", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as {
        jobId?: string;
        ok?: boolean;
        error?: string;
      };
      if (data.jobId && data.jobId !== id) return;
      setLive((prev) => ({
        ...prev,
        status: data.ok === false ? "error" : "done",
        error: data.error,
      }));
    });
    return () => es.close();
  }, [projectId, id]);

  useEffect(() => {
    textRef.current?.scrollTo({ top: textRef.current.scrollHeight });
  }, [live.text]);

  const models = catalog.data?.models ?? (model ? [model] : []);
  const debug = initial.data?.debug;
  const sessionError = live.error || job.data?.error || debug?.jobError || debug?.sessionError || undefined;
  const failed = live.status === "error" || job.data?.state === "failed" || Boolean(sessionError);
  const awaiting = Boolean(job.data?.state.startsWith("awaiting_"));
  const finished = ["done", "paused", "rejected"].includes(job.data?.state ?? "");
  const busy = live.status === "running" || Boolean(initial.data?.running) || retry.isPending;
  const canRetry = !busy && !awaiting && !finished;
  const errorEvents = (debug?.events ?? []).filter((e: DebugEvent) => e.level === "error" || e.event.endsWith(".end"));

  return (
    <div className="min-h-screen">
      <AppHeader
        right={
          <Button variant="ghost" size="sm" onClick={() => router.push(`/board/${id}?project=${projectId}`)}>
            <ArrowLeft />
            Ticket
          </Button>
        }
      />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <p className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
          Agent session
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{job.data?.title ?? "Ticket"}</h1>
          <Badge
            variant={
              live.status === "running" ? "approval" : live.status === "error" || failed ? "failed" : "default"
            }
          >
            {live.status}
          </Badge>
          {(job.data?.column || live.lane) && (
            <Badge variant="outline">
              {job.data?.column === "planning"
                ? "planning"
                : job.data?.column === "tech_spec"
                  ? "tech spec"
                  : job.data?.column?.replaceAll("_", " ") || live.lane.replaceAll("_", " ")}
            </Badge>
          )}
          {initial.data?.sessionLane &&
            initial.data.sessionLane !== job.data?.state &&
            initial.data.sessionLane !== "requirements" && (
              <Badge variant="outline">session · {String(initial.data.sessionLane).replaceAll("_", " ")}</Badge>
            )}
          <Badge variant={sseState === "live" ? "success" : "outline"}>
            {sseState === "live" ? "stream live" : sseState === "error" ? "stream reconnecting" : "stream off"}
          </Badge>
        </div>
        {live.risk && (
          <p className="text-sm">
            Risk: <span className="font-medium">{live.risk}</span>
            {live.classification ? ` · ${live.classification}` : ""}
          </p>
        )}

        {failed && (
          <Card className="border-red-200 bg-red-50">
            <CardHeader>
              <CardTitle className="text-sm text-red-900">Why this session failed</CardTitle>
              <CardDescription className="text-red-800/80">
                Lane {debug?.lastActiveState || live.lane || job.data?.lastActiveState || "unknown"} · column{" "}
                {debug?.boardColumn || job.data?.column || "—"} · state {debug?.jobState || job.data?.state}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-red-950">
              <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                {sessionError || "The session ended without a stored error. Check the event log below."}
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-red-800/80">Model</dt>
                <dd className="font-mono">{live.model || initial.data?.model || "—"}</dd>
                <dt className="text-red-800/80">Job state</dt>
                <dd className="font-mono">{debug?.jobState || job.data?.state || "—"}</dd>
                <dt className="text-red-800/80">Last lane</dt>
                <dd className="font-mono">{debug?.lastActiveState || live.lane || "—"}</dd>
                <dt className="text-red-800/80">Updated</dt>
                <dd className="font-mono">{initial.data?.updatedAt || "—"}</dd>
              </dl>
              {live.tools.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-red-800">Tools used before failure</p>
                  <div className="flex flex-wrap gap-1">
                    {live.tools.map((t, i) => (
                      <Badge key={`${t.name}-${i}`} variant="outline">
                        {t.name}
                        {t.detail ? ` ${t.detail.slice(0, 40)}` : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <Collapse title="Event log" hint={`${errorEvents.length} recent events`} defaultOpen>
                <ol className="space-y-2 font-mono text-[11px] leading-relaxed">
                  {errorEvents.length === 0 && <li className="text-muted-foreground">No stored events.</li>}
                  {errorEvents.map((e: DebugEvent) => (
                    <li key={e.id}>
                      <span className="text-muted-foreground">{e.createdAt.slice(11, 19)}</span>{" "}
                      <span className={e.level === "error" ? "font-semibold text-red-800" : ""}>
                        {e.level} {e.event}
                      </span>
                      <pre className="mt-0.5 max-h-28 overflow-auto whitespace-pre-wrap text-red-950/80">
                        {e.payload}
                      </pre>
                    </li>
                  ))}
                </ol>
              </Collapse>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => retry.mutate({ id })}>
                <RotateCcw />
                Retry this lane
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Model</CardTitle>
            <CardDescription>Sessions stay on this ticket URL. Thinking is collapsed so you can read the response.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="session-model">Available models</Label>
              <select
                id="session-model"
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                value={model}
                disabled={busy || models.length === 0}
                onChange={(e) => {
                  const next = e.target.value;
                  setModelLocal(next);
                  setModel.mutate({ id, model: next });
                }}
              >
                {models.length === 0 && <option value="">Loading models…</option>}
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                    {m === catalog.data?.defaultModel ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="outline" disabled={!canRetry || busy} onClick={() => retry.mutate({ id })}>
              <RotateCcw />
              {retry.isPending ? "Starting…" : live.status === "error" || job.data?.state === "failed" ? "Retry" : "Start"}
            </Button>
          </CardContent>
          {setModel.error && <p className="px-5 pb-4 text-sm text-destructive">{setModel.error.message}</p>}
          {retry.error && <p className="px-5 pb-4 text-sm text-destructive">{retry.error.message}</p>}
          <div className="border-t border-border px-5 py-4">
            <AgentRunControls
              jobId={id}
              running={busy}
              defaultStep={
                job.data?.column === "planning"
                  ? "planning"
                  : job.data?.column === "tech_spec"
                    ? "tech_spec"
                    : job.data?.column ?? "triage"
              }
            />
          </div>
        </Card>

        {(initial.data?.history ?? []).map((h) => (
          <Card key={h.id ?? `${h.lane}-${h.updatedAt}`}>
            <CardHeader>
              <CardTitle className="text-sm">
                {h.lane} · {h.status}
                {h.risk ? ` · risk ${h.risk}` : ""}
              </CardTitle>
              <CardDescription>Saved session · {h.updatedAt}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {h.status === "error" && h.error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 font-mono text-xs text-red-900">
                  {h.error}
                </p>
              )}
              <Collapse title="Thinking" hint={h.thinking ? `${h.thinking.length} chars` : "empty"}>
                <pre className="max-h-[24vh] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
                  {h.thinking || "—"}
                </pre>
              </Collapse>
              {h.text ? (
                <pre className="max-h-[24vh] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">
                  {h.text}
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground">No response text stored for this lane.</p>
              )}
            </CardContent>
          </Card>
        ))}

        <Collapse
          title="Thinking"
          hint={
            live.status === "running"
              ? live.thinking
                ? `in progress · ${live.thinking.length} chars`
                : "waiting for the model…"
              : live.thinking
                ? `${live.thinking.length} chars`
                : "empty"
          }
        >
          <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
            {live.thinking || (live.status === "running" ? "Waiting for the model…" : "No thinking captured yet.")}
          </pre>
        </Collapse>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Response</CardTitle>
            <CardDescription>What the agent produced (artifact text, file changes, JSON)</CardDescription>
          </CardHeader>
          <CardContent>
            <pre
              ref={textRef}
              className="max-h-[50vh] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed"
            >
              {live.text || "—"}
            </pre>
          </CardContent>
        </Card>

        {live.tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {live.tools.map((t, i) => (
              <Badge key={`${t.name}-${i}`} variant="outline">
                {t.name}
              </Badge>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default function AgentSessionPage() {
  return (
    <Suspense>
      <AgentGate>
        <SessionInner />
      </AgentGate>
    </Suspense>
  );
}
