"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc/client";

type ArtifactRow = {
  id: string;
  kind: string;
  version: number;
  source: string;
  body: string;
};

function latest(rows: ArtifactRow[], kind: string) {
  return rows
    .filter((r) => r.kind === kind)
    .sort((a, b) => b.version - a.version)[0];
}

export function ApprovalWorkspace({
  jobId,
  projectId,
}: {
  jobId: string;
  projectId: string;
}) {
  const job = trpc.jobs.get.useQuery({ id: jobId }, { refetchInterval: 3000 });
  const arts = trpc.jobs.artifacts.useQuery({ id: jobId }, { refetchInterval: 3000 });
  const events = trpc.jobs.events.useQuery({ id: jobId });
  const approve = trpc.jobs.approve.useMutation({
    onSuccess: () => {
      void job.refetch();
      void arts.refetch();
    },
  });
  const retry = trpc.jobs.retryImplementation.useMutation({ onSuccess: () => job.refetch() });
  const reopen = trpc.jobs.reopen.useMutation();
  const [tab, setTab] = useState<"visual" | "markdown">("visual");
  const [note, setNote] = useState("");
  const [edit, setEdit] = useState("");

  const fr = latest(arts.data ?? [], "fr");
  const spec = latest(arts.data ?? [], "tech_spec");
  const tasks = latest(arts.data ?? [], "task_graph");
  const review = latest(arts.data ?? [], "review");
  const current =
    job.data?.state.includes("requirements")
      ? fr
      : job.data?.state.includes("tech_spec")
        ? spec
        : job.data?.state.includes("tasks") || job.data?.state === "implementation"
          ? tasks
          : review;

  const parsed = useMemo(() => {
    try {
      return current ? JSON.parse(current.body) : null;
    } catch {
      return null;
    }
  }, [current]);

  const gate = job.data?.state.startsWith("awaiting_")
    ? job.data.state.replace("awaiting_", "").replace("_approval", "")
    : null;

  return (
    <div className="shell" style={{ maxWidth: 1100 }}>
      <a href={`/board?project=${projectId}`}>← Board</a>
      <h1>{job.data?.title}</h1>
      <div className="row">
        <span className="badge">{job.data?.state}</span>
        {job.data?.local && <span className="badge local">Local</span>}
        {job.data?.badge && <span className={`badge ${job.data.badge}`}>{job.data.badge}</span>}
        {job.data?.prUrl && (
          <a href={job.data.prUrl} target="_blank" rel="noreferrer">
            Pull request
          </a>
        )}
      </div>
      <div className="row">
        <button type="button" onClick={() => setTab("visual")}>
          Visual
        </button>
        <button type="button" onClick={() => setTab("markdown")}>
          Markdown / JSON
        </button>
      </div>
      {tab === "visual" ? (
        <Visual body={parsed} />
      ) : (
        <textarea
          value={edit || (current?.body ?? "")}
          onChange={(e) => setEdit(e.target.value)}
        />
      )}
      {gate && (
        <div className="col">
          <textarea
            placeholder="Note (required for reject / send back)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="row">
            <button
              className="primary"
              type="button"
              onClick={() => {
                let artifact: unknown;
                try {
                  artifact = JSON.parse(edit || current?.body || "null");
                } catch {
                  artifact = undefined;
                }
                approve.mutate({
                  id: jobId,
                  action: "approve",
                  artifact,
                  note: note || undefined,
                });
              }}
            >
              Approve
            </button>
            {gate === "review" && (
              <button
                type="button"
                onClick={() =>
                  approve.mutate({ id: jobId, action: "send_back", note: note || "send back" })
                }
              >
                Send back
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                approve.mutate({ id: jobId, action: "reject", note: note || "rejected" })
              }
            >
              Reject
            </button>
          </div>
        </div>
      )}
      {job.data?.state === "failed" && job.data.lastActiveState === "implementation" && (
        <button type="button" onClick={() => retry.mutate({ id: jobId })}>
          Retry implementation
        </button>
      )}
      {["rejected", "failed"].includes(job.data?.state ?? "") && (
        <button type="button" onClick={() => reopen.mutate({ id: jobId })}>
          Reopen as new job
        </button>
      )}
      {approve.error && <p className="error">{approve.error.message}</p>}
      <h3>Log</h3>
      <pre className="card" style={{ maxHeight: 240, overflow: "auto" }}>
        {(events.data ?? [])
          .map((e) => `${e.createdAt} ${e.event} ${e.payload}`)
          .join("\n")}
      </pre>
    </div>
  );
}

function Visual({ body }: { body: unknown }) {
  if (!body || typeof body !== "object") return <p className="muted">No artifact yet.</p>;
  const o = body as Record<string, unknown>;
  if (Array.isArray(o.tasks)) {
    return (
      <div className="col">
        {(o.tasks as { id: string; title: string; status: string; dependsOn?: string[] }[]).map(
          (t) => (
            <div key={t.id} className="card">
              <strong>
                {t.id} {t.title}
              </strong>
              <div className="muted">
                {t.status} · deps {t.dependsOn?.join(", ") || "—"}
              </div>
            </div>
          ),
        )}
      </div>
    );
  }
  if (Array.isArray(o.findings) || o.verdict) {
    const findings = (o.findings as { id: string; file: string; severity: string; title: string; body: string }[]) ?? [];
    return (
      <div className="col">
        <p>
          Verdict: <strong>{String(o.verdict)}</strong> — {String(o.summary ?? "")}
        </p>
        {findings.map((f) => (
          <div key={f.id} className="card">
            <span className={`badge ${f.severity === "blocker" || f.severity === "major" ? "failed" : ""}`}>
              {f.severity}
            </span>{" "}
            {f.file}: {f.title}
            <div className="muted">{f.body}</div>
          </div>
        ))}
      </div>
    );
  }
  const outline = (o.visualPlan as { outline?: { id: string; title: string }[]; mermaid?: string }) ?? {};
  return (
    <div className="col">
      <p>{String(o.summary ?? "")}</p>
      <ul>
        {(outline.outline ?? []).map((n) => (
          <li key={n.id}>{n.title}</li>
        ))}
      </ul>
      {outline.mermaid && (
        <pre className="card">
          {outline.mermaid}
        </pre>
      )}
    </div>
  );
}
