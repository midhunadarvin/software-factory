"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Kanban } from "@/components/Kanban";

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
    return () => es.close();
  }, [projectId, cards]);

  if (!projectId) {
    router.replace("/open");
    return null;
  }
  const project = projects.data?.find((p) => p.id === projectId);

  return (
    <div>
      <div className="nav">
        <div className="row">
          <strong>Software Factory</strong>
          <span className="muted">{project?.name}</span>
        </div>
        <div className="row">
          <a href="/open">Switch repo</a>
          <a href={`/settings?project=${projectId}`}>Settings</a>
        </div>
      </div>
      <div className="shell" style={{ maxWidth: "none", margin: "16px" }}>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            create.mutate({ projectId, title, body });
            setTitle("");
            setBody("");
          }}
        >
          <input
            placeholder="New job title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input placeholder="Brief" value={body} onChange={(e) => setBody(e.target.value)} />
          <button className="primary" type="submit">
            Create job
          </button>
        </form>
      </div>
      {(cards.data?.length ?? 0) === 0 ? (
        <div className="shell">
          <p className="muted">No jobs yet. Create a job, or label a GitHub issue `factory`.</p>
        </div>
      ) : (
        <Kanban projectId={projectId} cards={cards.data ?? []} />
      )}
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
