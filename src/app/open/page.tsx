"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FolderGit2, GitBranch, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { AppHeader } from "@/components/AppChrome";
import { AgentGate } from "@/components/AgentGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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
  const validate = trpc.projects.validatePath.useQuery({ rootPath }, { enabled: false });
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
    <div className="min-h-screen">
      <AppHeader />
      <AgentGate>
      <main className="mx-auto max-w-2xl px-4 py-12">
        <p className="mb-2 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
          01 · Workspace
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Open a repository</h1>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          Attach a local git folder or clone from GitHub. Agents read that tree and implement in an isolated worktree.
        </p>

        <Card className="mt-8">
          <CardHeader>
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setTab("local")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === "local" ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <FolderGit2 className="size-3.5" />
                Local folder
              </button>
              <button
                type="button"
                onClick={() => setTab("clone")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === "clone" ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <GitBranch className="size-3.5" />
                Clone GitHub
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {tab === "local" ? (
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  openLocal.mutate({
                    name: name || rootPath,
                    rootPath,
                    githubPat: pat || undefined,
                  });
                }}
              >
                <Field label="Project name">
                  <Input placeholder="my-app" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Absolute path">
                  <Input
                    placeholder="/Users/you/src/repo"
                    value={rootPath}
                    onChange={(e) => setRootPath(e.target.value)}
                  />
                </Field>
                <Field label="GitHub PAT · optional">
                  <Input
                    type="password"
                    placeholder="For issues and pull requests"
                    value={pat}
                    onChange={(e) => setPat(e.target.value)}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    type="button"
                    onClick={async () => {
                      const r = await validate.refetch();
                      setMsg(
                        r.data?.ok
                          ? `Valid · ${r.data.defaultBranch}${r.data.github ? ` · ${r.data.github.owner}/${r.data.github.repo}` : " · local only"}`
                          : (r.data?.error ?? "invalid"),
                      );
                    }}
                  >
                    Validate
                  </Button>
                  <Button type="submit" disabled={openLocal.isPending}>
                    Attach
                  </Button>
                </div>
              </form>
            ) : (
              <form
                className="flex flex-col gap-4"
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
                <Field label="Project name">
                  <Input placeholder="my-app" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="owner/repo or URL">
                  <Input
                    placeholder="acme/api"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                  />
                </Field>
                <Field label="Clone destination · optional">
                  <Input
                    placeholder="~/software-factory/repos/…"
                    value={dest}
                    onChange={(e) => setDest(e.target.value)}
                  />
                </Field>
                <Field label="GitHub PAT">
                  <Input
                    type="password"
                    placeholder="Required for private repos"
                    value={pat}
                    onChange={(e) => setPat(e.target.value)}
                  />
                </Field>
                {ghRepos.data && ghRepos.data.length > 0 && (
                  <select
                    className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                    onChange={(e) => setRepoUrl(e.target.value)}
                    defaultValue=""
                  >
                    <option value="">Pick a repo the token can see</option>
                    {ghRepos.data.map((r) => (
                      <option key={r.full_name} value={r.full_name}>
                        {r.full_name}
                      </option>
                    ))}
                  </select>
                )}
                <Button type="submit" disabled={clone.isPending}>
                  Clone and attach
                </Button>
              </form>
            )}
            {msg && <p className="mt-4 text-sm text-muted-foreground">{msg}</p>}
          </CardContent>
        </Card>

        <section className="mt-10">
          <p className="mb-3 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Recent
          </p>
          <div className="flex flex-col gap-2">
            {(projects.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No workspaces yet.</p>
            )}
            {(projects.data ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => router.push(`/board?project=${p.id}`)}
                className="group flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left shadow-xs transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <Badge variant={p.remoteKind === "github" ? "outline" : "local"}>
                      {p.remoteKind === "github" ? "GitHub" : "Local"}
                    </Badge>
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">{p.rootPath}</p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </section>
      </main>
      </AgentGate>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
