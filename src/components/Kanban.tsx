"use client";

import { useRouter } from "next/navigation";
import { GitPullRequest } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { IntakeLaunch } from "@/components/IntakeLaunch";

const LANES = [
  { id: "intake", label: "Intake", n: "00" },
  { id: "triage", label: "Triage", n: "01" },
  { id: "planning", label: "Planning", n: "03" },
  { id: "tech_spec", label: "Tech spec", n: "04" },
  { id: "tasks", label: "Tasks", n: "05" },
  { id: "implementation", label: "Implementation", n: "06" },
  { id: "pull_request", label: "PR", n: "07" },
  { id: "done", label: "Done", n: "08" },
] as const;

export type Card = {
  id: string;
  title: string;
  column: string;
  badge: string | null;
  local: boolean;
  issueUrl: string;
  tokensUsed: number;
  prUrl: string | null;
  triage?: { classification: string; risk: string; fastTrack: boolean };
  agent?: "running" | "completed" | "failed" | "idle";
  agentLane?: string;
  model?: string | null;
  error?: string | null;
};

const badgeVariant = {
  approval: "approval",
  failed: "failed",
  paused: "paused",
  rejected: "rejected",
  queued: "queued",
} as const;

export function Kanban({ projectId, cards }: { projectId: string; cards: Card[] }) {
  const router = useRouter();
  return (
    <div className="grid grid-cols-1 gap-3 overflow-x-auto p-4 md:grid-cols-3 xl:grid-cols-8">
      {LANES.map((lane) => {
        const laneCards = cards.filter((c) => c.column === lane.id);
        return (
          <section key={lane.id} className="flex min-h-[62vh] min-w-[220px] flex-col rounded-xl bg-muted/50 p-2">
            <header className="flex items-baseline justify-between px-2 py-2">
              <h3 className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                <span className="mr-1.5 font-mono text-[10px] opacity-60">{lane.n}</span>
                {lane.label}
              </h3>
              <span className="font-mono text-[11px] text-muted-foreground">{laneCards.length}</span>
            </header>
            <div className="flex flex-1 flex-col gap-2">
              {laneCards.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "rounded-lg border bg-card p-3 text-left shadow-xs transition-all hover:-translate-y-px hover:shadow-sm",
                    c.agent === "running" && "border-sky-200 ring-1 ring-sky-100",
                    c.badge === "approval" && "border-amber-200 ring-1 ring-amber-100",
                    (c.badge === "failed" || c.agent === "failed") && "border-red-200",
                    c.agent === "completed" && c.badge !== "failed" && "border-emerald-200",
                    !c.badge && c.agent === "idle" && "border-border",
                    c.column === "intake" && "border-violet-200",
                  )}
                >
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        c.column === "intake" || c.badge
                          ? `/board/${c.id}?project=${projectId}`
                          : `/board/${c.id}/session?project=${projectId}`,
                      )
                    }
                    className="w-full text-left"
                  >
                  <p className="line-clamp-3 text-sm font-medium leading-snug">{c.title}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {c.agent === "running" && (
                      <Badge variant="queued" className="gap-1">
                        <span className="size-1.5 animate-pulse rounded-full bg-sky-600" />
                        Running{c.agentLane ? ` · ${c.agentLane}` : ""}
                      </Badge>
                    )}
                    {c.agent === "completed" && (
                      <Badge variant="success">Completed</Badge>
                    )}
                    {c.agent === "failed" && c.badge !== "failed" && (
                      <Badge variant="failed">Failed</Badge>
                    )}
                    {c.local && <Badge variant="local">Local</Badge>}
                    {c.triage && (
                      <Badge variant={c.triage.fastTrack ? "success" : "outline"}>
                        {c.triage.classification}
                        {c.triage.fastTrack ? " · fast" : ""}
                      </Badge>
                    )}
                    {c.badge && (
                      <Badge variant={badgeVariant[c.badge as keyof typeof badgeVariant] ?? "default"}>
                        {c.badge === "approval" ? "Review · approve or reject" : c.badge}
                      </Badge>
                    )}
                    {c.model && c.column !== "intake" && (
                      <Badge variant="outline" className="max-w-full truncate font-mono">
                        {c.model}
                      </Badge>
                    )}
                    {c.prUrl && (
                      <Badge variant="outline" className="gap-1">
                        <GitPullRequest className="size-3" />
                        PR
                      </Badge>
                    )}
                  </div>
                  {(c.badge === "failed" || c.agent === "failed") && c.error && (
                    <p className="mt-2 line-clamp-3 font-mono text-[11px] leading-snug text-red-800">
                      {c.error.split("\n")[0]}
                    </p>
                  )}
                  {c.tokensUsed > 0 && (
                    <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                      {c.tokensUsed.toLocaleString()} tokens
                    </p>
                  )}
                  </button>
                  {c.column === "intake" && (
                    <IntakeLaunch jobId={c.id} currentModel={c.model} compact className="mt-3" />
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
