"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { FolderGit2, Plus, Settings2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Kanban } from "@/components/Kanban";
import { AppHeader } from "@/components/AppChrome";
import { AgentGate } from "@/components/AgentGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function BoardInner() {
  const params = useSearchParams();
  const router = useRouter();
  const projectId = params.get("project");
  const projects = trpc.projects.list.useQuery();
  const cards = trpc.jobs.list.useQuery(
    { projectId: projectId ?? "" },
    { enabled: Boolean(projectId), refetchInterval: 4000 },
  );
  const create = trpc.jobs.create.useMutation({
    onSuccess: () => cards.refetch(),
  });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!projectId) return;
    const es = new EventSource(`/api/events?projectId=${projectId}`);
    es.onmessage = () => {
      void cards.refetch();
    };
    es.addEventListener("job.upsert", () => void cards.refetch());
    es.addEventListener("job.approval_needed", () => void cards.refetch());
    es.addEventListener("lane.agent.start", () => void cards.refetch());
    es.addEventListener("lane.agent.end", () => void cards.refetch());
    return () => es.close();
  }, [projectId, cards]);

  if (!projectId) {
    router.replace("/open");
    return null;
  }
  const project = projects.data?.find((p) => p.id === projectId);

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        left={
          <span className="hidden truncate text-sm text-muted-foreground sm:inline">
            {project?.name}
          </span>
        }
        right={
          <>
            <Button variant="ghost" size="sm" onClick={() => router.push("/open")}>
              <FolderGit2 />
              Repos
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.push(`/settings?project=${projectId}`)}>
              <Settings2 />
              Settings
            </Button>
          </>
        }
      />

      <AgentGate>
      <div className="mx-auto w-full max-w-[1600px] px-4 pt-5">
        <form
          className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-xs sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            create.mutate({ projectId, title, body });
            setTitle("");
            setBody("");
          }}
        >
          <Input
            className="border-0 shadow-none focus-visible:ring-0"
            placeholder="New job title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input
            className="border-0 shadow-none focus-visible:ring-0"
            placeholder="Brief requirements…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button type="submit" disabled={create.isPending} className="shrink-0">
            <Plus />
            Create job
          </Button>
        </form>
      </div>

      {(cards.data?.length ?? 0) === 0 ? (
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <p className="text-sm font-medium">No jobs on the line</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a job above, or label a GitHub issue <code className="rounded bg-muted px-1">factory</code>.
          </p>
        </div>
      ) : (
        <Kanban
          projectId={projectId}
          cards={cards.data ?? []}
          columns={project?.pipeline?.columns}
        />
      )}
      </AgentGate>
    </div>
  );
}

export default function BoardPage() {
  return (
    <Suspense>
      <BoardInner />
    </Suspense>
  );
}
