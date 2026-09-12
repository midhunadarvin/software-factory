"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RotateCcw, ExternalLink, Trash2, Radio } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { AppHeader } from "@/components/AppChrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MdxPreview } from "@/components/MdxPreview";
import { AgentRunControls } from "@/components/AgentRunControls";
import { IntakeLaunch } from "@/components/IntakeLaunch";
import { frMdx, prMarkdown, reviewMarkdown, specMdx, tasksMarkdown } from "@/lib/artifacts/templates";

type ArtifactRow = {
  id: string;
  kind: string;
  version: number;
  source: string;
  body: string;
};

const DEFAULT_LANES = [
  { id: "intake", label: "Intake" },
  { id: "triage", label: "Triage" },
  { id: "planning", label: "Planning" },
  { id: "tech_spec", label: "Tech spec" },
  { id: "tasks", label: "Tasks" },
  { id: "implementation", label: "Implementation" },
  { id: "pull_request", label: "PR" },
  { id: "done", label: "Done" },
];

function laneLabel(
  column?: string | null,
  state?: string | null,
  lanes: { id: string; label: string }[] = DEFAULT_LANES,
) {
  const fromCol = lanes.find((l) => l.id === column)?.label;
  if (fromCol) return fromCol;
  if (state === "inbox" || state === "intake") return "Intake";
  if (state === "triage") return "Triage";
  if (state?.includes("requirements")) return "Planning";
  if (state?.includes("tech_spec")) return "Tech spec";
  if (state?.includes("tasks")) return "Tasks";
  if (state === "implementation") return "Implementation";
  if (state === "review") return "Review";
  if (state === "pull_request") return "PR";
  if (state === "done") return "Done";
  return state || "…";
}

function documentSource(parsed: unknown, fallback?: string): string {
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.tasks)) return tasksMarkdown(parsed as never);
    if ("modules" in o) return specMdx(parsed as never);
    if ("requirements" in o) return frMdx(parsed as never);
    if ("verdict" in o) return reviewMarkdown(parsed as never);
    if (typeof o.title === "string" && typeof o.body === "string") return prMarkdown(o.title, o.body);
  }
  return fallback ?? "No document yet. Wait for the agent to finish this lane.";
}

function latest(rows: ArtifactRow[], kind: string) {
  return rows.filter((r) => r.kind === kind).sort((a, b) => b.version - a.version)[0];
}

function failureHint(error: string): string | null {
  if (/Resource not accessible by personal access token/i.test(error)) {
    return "GitHub rejected the PAT. Classic tokens need the repo scope; fine-grained tokens need Pull requests: Read and write on this repository.";
  }
  if (/gh CLI is not installed/i.test(error)) {
    return "Install the GitHub CLI (`gh`) and make sure it is on PATH, or the factory will fall back to the REST API.";
  }
  if (/push failed|git push/i.test(error) && /exit 1|fail git push/i.test(error)) {
    return "The feature branch did not push. Check remote auth, branch protection, and that origin is reachable.";
  }
  return null;
}

export function ApprovalWorkspace({
  jobId,
  projectId,
}: {
  jobId: string;
  projectId: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const job = trpc.jobs.get.useQuery({ id: jobId }, { refetchInterval: 1500 });
  const project = trpc.projects.get.useQuery({ id: projectId }, { enabled: Boolean(projectId) });
  const arts = trpc.jobs.artifacts.useQuery({ id: jobId }, { refetchInterval: 2000 });
  const events = trpc.jobs.events.useQuery({ id: jobId }, { refetchInterval: 2500 });
  const session = trpc.jobs.session.useQuery({ id: jobId }, { refetchInterval: 2000 });
  const gate = job.data?.state.startsWith("awaiting_")
    ? job.data.state.replace("awaiting_", "").replace("_approval", "")
    : null;
  const approve = trpc.jobs.approve.useMutation({
    onSuccess: (_data, input) => {
      void job.refetch();
      void arts.refetch();
      void utils.jobs.list.invalidate();
      if (
        input.action === "approve" &&
        (gate === "requirements" || gate === "tech_spec")
      ) {
        router.push(`/board?project=${projectId}`);
      }
    },
  });
  const retry = trpc.jobs.retryImplementation.useMutation({ onSuccess: () => job.refetch() });
  const reopen = trpc.jobs.reopen.useMutation({
    onSuccess: (r) => router.push(`/board/${r.id}?project=${projectId}`),
  });
  const remove = trpc.jobs.delete.useMutation({
    onSuccess: () => router.push(`/board?project=${projectId}`),
  });
  const [tab, setTab] = useState<"review" | "visual" | "markdown">("review");
  const [note, setNote] = useState("");
  const [edit, setEdit] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openAsDraft, setOpenAsDraft] = useState(false);

  const boardLanes = project.data?.pipeline?.columns ?? DEFAULT_LANES;
  const column = job.data?.column ?? "triage";
  const currentLane = laneLabel(column, job.data?.state, boardLanes);
  const triage = latest(arts.data ?? [], "triage");
  const fr = latest(arts.data ?? [], "fr");
  const spec = latest(arts.data ?? [], "tech_spec");
  const tasks = latest(arts.data ?? [], "task_graph");
  const review = latest(arts.data ?? [], "review");
  const pr = latest(arts.data ?? [], "pr");
  const current =
    column === "triage"
      ? triage
      : column === "planning"
        ? fr
        : column === "tech_spec"
          ? spec
          : column === "tasks" || column === "implementation"
            ? tasks
            : column === "pull_request" && (job.data?.state === "pull_request" || job.data?.state === "awaiting_pr_approval")
              ? pr ?? review
              : review ?? spec ?? fr ?? triage;

  const parsed = useMemo(() => {
    try {
      return current ? JSON.parse(current.body) : null;
    } catch {
      return null;
    }
  }, [current]);

  return (
    <div className="min-h-screen">
      <AppHeader
        right={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/board/${jobId}/session?project=${projectId}`)}
            >
              <Radio />
              Agent session
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.push(`/board?project=${projectId}`)}>
              <ArrowLeft />
              Board
            </Button>
          </>
        }
      />
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <p className="mb-2 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Job · {currentLane}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{job.data?.title ?? "Loading…"}</h1>
          <div className="mt-3 flex flex-wrap gap-1">
            {boardLanes.map((lane) => {
              const active = column === lane.id;
              const passed = boardLanes.findIndex((l) => l.id === column) > boardLanes.findIndex((l) => l.id === lane.id);
              return (
                <Badge
                  key={lane.id}
                  variant={active ? "approval" : passed ? "success" : "outline"}
                  className={cn(!active && !passed && "opacity-50")}
                >
                  {lane.label}
                  {active && session.data?.running ? " · running" : ""}
                  {active && job.data?.state === "failed" ? " · failed" : ""}
                </Badge>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {job.data?.local && <Badge variant="local">Local</Badge>}
            {session.data?.running && <Badge variant="approval">Agent running · {session.data.lane}</Badge>}
            {job.data?.badge && (
              <Badge
                variant={
                  job.data.badge === "approval"
                    ? "approval"
                    : job.data.badge === "failed"
                      ? "failed"
                      : "default"
                }
              >
                {job.data.badge === "approval" ? "Needs approval" : job.data.badge}
              </Badge>
            )}
            {job.data?.triage && (
              <Badge variant={job.data.triage.fastTrack ? "success" : "outline"}>
                {job.data.triage.classification}
                {job.data.triage.risk ? ` · ${job.data.triage.risk} risk` : ""}
              </Badge>
            )}
            {job.data?.prUrl && (
              <a href={job.data.prUrl} target="_blank" rel="noreferrer">
                <Badge variant="outline" className="gap-1">
                  Pull request <ExternalLink className="size-3" />
                </Badge>
              </a>
            )}
          </div>

          {(job.data?.state === "failed" || job.data?.error) && (
            <Card className="mt-6 border-red-200 bg-red-50">
              <CardHeader>
                <CardTitle className="text-sm text-red-900">Why this step failed</CardTitle>
                <CardDescription className="text-red-800/80">
                  {currentLane} · state {job.data?.state ?? "—"} · last lane{" "}
                  {job.data?.lastActiveState ?? "—"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-red-950">
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-red-200 bg-white/70 p-3 font-mono text-xs leading-relaxed">
                  {job.data?.error ||
                    session.data?.error ||
                    session.data?.debug?.jobError ||
                    "The ticket is marked failed, but no error text was stored."}
                </pre>
                {failureHint(job.data?.error || session.data?.error || "") && (
                  <p className="text-sm leading-relaxed text-red-900">
                    {failureHint(job.data?.error || session.data?.error || "")}
                  </p>
                )}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-red-800/80">Branch</dt>
                  <dd className="font-mono break-all">{job.data?.branch || "—"}</dd>
                  <dt className="text-red-800/80">Worktree</dt>
                  <dd className="font-mono break-all">{job.data?.worktreePath || "—"}</dd>
                  <dt className="text-red-800/80">Model</dt>
                  <dd className="font-mono">{job.data?.model || session.data?.model || "—"}</dd>
                  <dt className="text-red-800/80">PR URL</dt>
                  <dd className="font-mono break-all">{job.data?.prUrl || "not opened"}</dd>
                </dl>
                <div>
                  <p className="mb-1 text-xs font-medium text-red-800">Recent events</p>
                  <ol className="max-h-48 space-y-2 overflow-auto font-mono text-[11px] leading-relaxed">
                    {(events.data ?? [])
                      .filter((e) => e.level === "error" || e.event.includes("fail") || e.event.endsWith(".end"))
                      .slice(-8)
                      .map((e) => (
                        <li key={e.id}>
                          <span className="text-red-800/70">{e.createdAt.slice(11, 19)}</span>{" "}
                          <span className={e.level === "error" ? "font-semibold" : ""}>
                            {e.level} {e.event}
                          </span>
                          {e.payload && e.payload !== "{}" && (
                            <pre className="mt-0.5 max-h-28 overflow-auto whitespace-pre-wrap text-red-950/80">
                              {e.payload}
                            </pre>
                          )}
                        </li>
                      ))}
                    {(events.data ?? []).every(
                      (e) => e.level !== "error" && !e.event.includes("fail") && !e.event.endsWith(".end"),
                    ) && <li className="text-muted-foreground">No failure events stored yet.</li>}
                  </ol>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/board/${jobId}/session?project=${projectId}`)}
                  >
                    <Radio />
                    Open session debug
                  </Button>
                </div>
                <p className="text-xs text-red-800/80">
                  After you fix the cause, restart from Review in the agent run panel to park a new PR draft and
                  approve again.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="mt-6 flex gap-1 rounded-lg bg-muted p-1 w-fit">
            {(["review", "visual", "markdown"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium capitalize",
                  tab === t ? "bg-card shadow-xs" : "text-muted-foreground",
                )}
              >
                {t === "markdown" ? "JSON" : t === "review" ? "MDX review" : "Visual"}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {tab === "review" ? (
              <MdxPreview
                title={
                  column === "tech_spec" || job.data?.state.includes("tech_spec")
                    ? "Technical specification"
                    : column === "planning" || (job.data?.state.includes("requirements") ?? false)
                      ? "Functional requirements"
                      : column === "tasks" || column === "implementation"
                        ? "Implementation tasks"
                        : column === "pull_request" && job.data?.state !== "review" && job.data?.state !== "awaiting_review_approval"
                          ? "Pull request"
                          : column === "done" || job.data?.state === "review"
                          ? "Review"
                          : "Document"
                }
                source={documentSource(parsed, current?.body)}
              />
            ) : tab === "visual" ? (
              <Visual body={parsed} />
            ) : (
              <Textarea
                className="min-h-72 font-mono text-xs"
                value={edit || (current?.body ?? "")}
                onChange={(e) => setEdit(e.target.value)}
              />
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          {(job.data?.state === "intake" || job.data?.column === "intake") && (
            <Card className="border-violet-200 shadow-sm">
              <CardHeader>
                <p className="text-[11px] font-medium tracking-[0.14em] text-violet-700 uppercase">
                  Intake
                </p>
                <CardTitle className="text-base">Choose a model</CardTitle>
                <CardDescription>
                  This ticket waits here until you pick a model and send it to triage. Agents will not start on their own.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <IntakeLaunch jobId={jobId} currentModel={job.data?.model} />
              </CardContent>
            </Card>
          )}
          {gate && (
            <Card className="border-amber-200 shadow-sm">
              <CardHeader>
                <p className="text-[11px] font-medium tracking-[0.14em] text-amber-700 uppercase">
                  Approval
                </p>
                <CardTitle className="text-base">Human review</CardTitle>
                <CardDescription>
                  {gate === "tech_spec"
                    ? "Read the tech-spec MDX, then approve to continue or reject."
                    : gate === "requirements"
                      ? "Read the planning MDX, then approve to start tech spec or reject."
                      : gate === "pr"
                        ? "Read the PR title and body. Approve to open it on GitHub (or as a draft), then the ticket moves to Done."
                      : `Review the ${gate.replace("_", " ")} artifact, then approve or send it back.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Textarea
                  placeholder="Note — required to reject or send back"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                {gate === "pr" && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={openAsDraft}
                      onChange={(e) => setOpenAsDraft(e.target.checked)}
                    />
                    Create as a GitHub draft PR
                  </label>
                )}
                <Button
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
                      draft: gate === "pr" ? openAsDraft : undefined,
                    });
                  }}
                >
                  {gate === "pr" ? (openAsDraft ? "Approve and create draft PR" : "Approve and open PR") : "Approve"}
                </Button>
                {gate === "review" && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      approve.mutate({ id: jobId, action: "send_back", note: note || "send back" })
                    }
                  >
                    Send back
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => approve.mutate({ id: jobId, action: "reject", note: note || "rejected" })}
                >
                  Reject
                </Button>
                {approve.error && <p className="text-sm text-destructive">{approve.error.message}</p>}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Agent run</CardTitle>
              <CardDescription>Stop the current agent or restart from a chosen lane.</CardDescription>
            </CardHeader>
            <CardContent>
              <AgentRunControls
                jobId={jobId}
                running={Boolean(session.data?.running)}
                defaultStep={column === "pull_request" ? "review" : column}
                steps={project.data?.pipeline?.restartSteps}
              />
            </CardContent>
          </Card>

          {job.data?.state === "failed" && job.data.lastActiveState === "implementation" && (
            <Button variant="outline" onClick={() => retry.mutate({ id: jobId })}>
              <RotateCcw />
              Retry implementation
            </Button>
          )}
          {["rejected", "failed"].includes(job.data?.state ?? "") && (
            <Button variant="secondary" onClick={() => reopen.mutate({ id: jobId })}>
              Reopen as new job
            </Button>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Delete ticket</CardTitle>
              <CardDescription>
                Removes this card from the board and stops its agents. The attached git repo is not deleted.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {!confirmDelete ? (
                <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 />
                  Delete
                </Button>
              ) : (
                <>
                  <p className="text-sm text-destructive">Delete this ticket permanently from the board?</p>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ id: jobId })}
                    >
                      {remove.isPending ? "Deleting…" : "Confirm delete"}
                    </Button>
                    <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
              {remove.error && <p className="text-sm text-destructive">{remove.error.message}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Thinking</CardTitle>
              <CardDescription>Agent events for this run</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="max-h-72 space-y-2 overflow-auto text-xs">
                {(events.data ?? []).length === 0 && (
                  <li className="text-muted-foreground">No events yet.</li>
                )}
                {(events.data ?? []).map((e) => (
                  <li
                    key={e.id}
                    className={cn(
                      "border-l-2 pl-3",
                      e.level === "error" ? "border-red-400" : "border-border",
                    )}
                  >
                    <div className={cn("font-medium", e.level === "error" && "text-red-800")}>
                      {e.event}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {e.createdAt.slice(11, 19)}
                      {e.level !== "info" ? ` · ${e.level}` : ""}
                    </div>
                    {e.payload && e.payload !== "{}" && (
                      <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
                        {e.payload}
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
}

function Visual({ body }: { body: unknown }) {
  if (!body || typeof body !== "object") {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Waiting for the agent to write this artifact…
        </CardContent>
      </Card>
    );
  }
  const o = body as Record<string, unknown>;
  if (o.classification && o.risk) {
    return (
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={o.fastTrack ? "success" : "outline"}>{String(o.classification)}</Badge>
            <Badge variant={o.risk === "high" ? "failed" : o.risk === "medium" ? "approval" : "default"}>
              {String(o.risk)} risk
            </Badge>
            {o.fastTrack ? <Badge variant="success">fast-track</Badge> : null}
          </div>
          <CardTitle className="text-base">Triage</CardTitle>
          <CardDescription>{String(o.rationale ?? "")}</CardDescription>
        </CardHeader>
        {Array.isArray(o.affectedAreas) && o.affectedAreas.length > 0 && (
          <CardContent className="flex flex-wrap gap-1.5 pt-0">
            {(o.affectedAreas as string[]).map((a) => (
              <Badge key={a} variant="outline">
                {a}
              </Badge>
            ))}
          </CardContent>
        )}
      </Card>
    );
  }
  if (Array.isArray(o.tasks)) {
    const tasks = o.tasks as {
      id: string;
      title: string;
      status: string;
      dependsOn?: string[];
      files?: string[];
      acceptance?: string[];
    }[];
    return (
      <div className="flex flex-col gap-2">
        {tasks.map((t, i) => (
          <div key={t.id} className="flex gap-3 rounded-xl border border-border bg-card p-3 shadow-xs">
            <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {t.id} {t.title}
                </span>
                <Badge
                  variant={
                    t.status === "done" ? "success" : t.status === "failed" ? "failed" : "default"
                  }
                >
                  {t.status}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                deps {t.dependsOn?.join(", ") || "—"}
                {t.files?.length ? ` · ${t.files.join(", ")}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (Array.isArray(o.findings) || o.verdict) {
    const findings =
      (o.findings as { id: string; file: string; severity: string; title: string; body: string }[]) ??
      [];
    return (
      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant={o.verdict === "approve" ? "success" : "approval"}>
                {String(o.verdict)}
              </Badge>
              <CardTitle className="text-base">Review</CardTitle>
            </div>
            <CardDescription>{String(o.summary ?? "")}</CardDescription>
          </CardHeader>
        </Card>
        {findings.map((f) => (
          <div key={f.id} className="rounded-xl border border-border bg-card p-3 shadow-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={f.severity === "blocker" || f.severity === "major" ? "failed" : "default"}>
                {f.severity}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">{f.file}</span>
            </div>
            <p className="mt-1 text-sm font-medium">{f.title}</p>
            <p className="text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>
    );
  }
  const outline =
    (o.visualPlan as { outline?: { id: string; title: string; notes?: string }[]; mermaid?: string }) ??
    {};
  return (
    <div className="flex flex-col gap-4">
      {typeof o.summary === "string" && o.summary ? (
        <p className="text-sm leading-relaxed">{o.summary}</p>
      ) : null}
      <ol className="space-y-2">
        {(outline.outline ?? []).map((n, i) => (
          <li key={n.id} className="flex gap-3 rounded-lg border border-border bg-card px-3 py-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <div className="text-sm font-medium">{n.title}</div>
              {n.notes && (
                <div className="text-xs text-muted-foreground">{String(n.notes)}</div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {outline.mermaid && (
        <pre className="overflow-auto rounded-xl border border-border bg-muted/40 p-4 font-mono text-xs">
          {outline.mermaid}
        </pre>
      )}
    </div>
  );
}
