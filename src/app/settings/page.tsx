"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { trpc } from "@/lib/trpc/client";

function SettingsInner() {
  const params = useSearchParams();
  const id = params.get("project") ?? "";
  const project = trpc.projects.get.useQuery({ id }, { enabled: Boolean(id) });
  const update = trpc.projects.update.useMutation();
  const rotate = trpc.projects.rotatePat.useMutation();
  const [pat, setPat] = useState("");
  if (!project.data) return <div className="shell">Loading…</div>;
  const p = project.data;
  return (
    <div className="shell">
      <h1>Settings</h1>
      <div className="col">
        <div>Path: {p.rootPath}</div>
        <div>
          Remote: {p.remoteKind}
          {p.repoOwner ? ` · ${p.repoOwner}/${p.repoName}` : ""}
        </div>
        <div>PAT stored: {p.hasPat ? "yes" : "no"}</div>
        <label className="row">
          <input
            type="checkbox"
            checked={p.pollEnabled}
            disabled={p.remoteKind !== "github" || !p.hasPat}
            onChange={(e) => update.mutate({ id, pollEnabled: e.target.checked })}
          />
          Poll GitHub issues
        </label>
        <input
          type="password"
          placeholder="Rotate GitHub PAT"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
        />
        <button
          type="button"
          onClick={() => rotate.mutate({ id, githubPat: pat })}
          disabled={!pat}
        >
          Save PAT
        </button>
        <p className="muted">
          LLM: {process.env.NEXT_PUBLIC_MODEL ?? "OPENAI_COMPAT_MODEL / grok-4.5"} — keys stay in
          env.
        </p>
        <a href={`/board?project=${id}`}>Back to board</a>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}
