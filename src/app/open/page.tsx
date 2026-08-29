"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";

export default function OpenPage() {
  const router = useRouter();
  const projects = trpc.projects.list.useQuery();
  const [tab, setTab] = useState<"local" | "clone">("local");
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [dest, setDest] = useState("");
  const [pat, setPat] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const validate = trpc.projects.validatePath.useQuery(
    { rootPath },
    { enabled: false },
  );
  const openLocal = trpc.projects.openLocal.useMutation({
    onSuccess: (p) => router.push(`/board?project=${p.id}`),
    onError: (e) => setMsg(e.message),
  });
  const clone = trpc.projects.cloneGithub.useMutation({
    onSuccess: (p) => router.push(`/board?project=${p.id}`),
    onError: (e) => setMsg(e.message),
  });
  const ghRepos = trpc.projects.listGithubRepos.useQuery(
    { githubPat: pat || undefined },
    { enabled: tab === "clone" && pat.length > 8 },
  );

  return (
    <div className="shell">
      <h1>Open a repository</h1>
      <p className="muted">
        Attach a local git folder or clone a GitHub repo. Agents run against that tree.
      </p>
      <div className="row">
        <button type="button" onClick={() => setTab("local")}>
          Local folder
        </button>
        <button type="button" onClick={() => setTab("clone")}>
          Clone from GitHub
        </button>
      </div>
      {tab === "local" ? (
        <form
          className="col"
          onSubmit={(e) => {
            e.preventDefault();
            openLocal.mutate({ name: name || rootPath, rootPath, githubPat: pat || undefined });
          }}
        >
          <input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            placeholder="Absolute path to git repo"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
          />
          <input
            placeholder="GitHub PAT (optional, for issues/PRs)"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            type="password"
          />
          <div className="row">
            <button
              type="button"
              onClick={async () => {
                const r = await validate.refetch();
                setMsg(
                  r.data?.ok
                    ? `ok · ${r.data.defaultBranch}${r.data.github ? ` · ${r.data.github.owner}/${r.data.github.repo}` : " · local only"}`
                    : r.data?.error ?? "invalid",
                );
              }}
            >
              Validate
            </button>
            <button className="primary" type="submit">
              Attach
            </button>
          </div>
        </form>
      ) : (
        <form
          className="col"
          onSubmit={(e) => {
            e.preventDefault();
            clone.mutate({
              name: name || repoUrl,
              repoUrl,
              destPath: dest || undefined,
              githubPat: pat || undefined,
            });
          }}
        >
          <input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            placeholder="owner/repo or GitHub URL"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
          <input
            placeholder="Clone dest (optional)"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
          />
          <input
            placeholder="GitHub PAT (required for private repos)"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            type="password"
          />
          {ghRepos.data && ghRepos.data.length > 0 && (
            <select onChange={(e) => setRepoUrl(e.target.value)} defaultValue="">
              <option value="">Pick a repo the token can see</option>
              {ghRepos.data.map((r) => (
                <option key={r.full_name} value={r.full_name}>
                  {r.full_name}
                </option>
              ))}
            </select>
          )}
          <button className="primary" type="submit">
            Clone and attach
          </button>
        </form>
      )}
      {msg && <p className="muted">{msg}</p>}
      <h2>Recent</h2>
      <div className="col">
        {(projects.data ?? []).map((p) => (
          <div
            key={p.id}
            className="card job"
            onClick={() => router.push(`/board?project=${p.id}`)}
          >
            <strong>{p.name}</strong>
            <div className="muted">{p.rootPath}</div>
            <span className="badge">{p.remoteKind === "github" ? "GitHub" : "Local"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
