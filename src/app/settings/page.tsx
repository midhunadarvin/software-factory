"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { AppHeader } from "@/components/AppChrome";
import { AgentGate } from "@/components/AgentGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SettingsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("project") ?? "";
  const project = trpc.projects.get.useQuery({ id }, { enabled: Boolean(id) });
  const update = trpc.projects.update.useMutation();
  const rotate = trpc.projects.rotatePat.useMutation();
  const [pat, setPat] = useState("");
  if (!project.data) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <p className="p-8 text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }
  const p = project.data;
  return (
    <div className="min-h-screen">
      <AppHeader
        right={
          <Button variant="ghost" size="sm" onClick={() => router.push(`/board?project=${id}`)}>
            <ArrowLeft />
            Board
          </Button>
        }
      />
      <AgentGate>
      <main className="mx-auto max-w-xl px-4 py-10">
        <p className="mb-2 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
          02 · Project
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>{p.name}</CardTitle>
            <CardDescription className="font-mono text-xs">{p.rootPath}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              <Badge variant={p.remoteKind === "github" ? "outline" : "local"}>
                {p.remoteKind === "github" ? "GitHub" : "Local only"}
              </Badge>
              {p.repoOwner && (
                <Badge variant="outline">
                  {p.repoOwner}/{p.repoName}
                </Badge>
              )}
              <Badge variant={p.hasPat ? "success" : "default"}>
                PAT {p.hasPat ? "stored" : "not set"}
              </Badge>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-input"
                checked={p.pollEnabled}
                disabled={p.remoteKind !== "github" || !p.hasPat}
                onChange={(e) => update.mutate({ id, pollEnabled: e.target.checked })}
              />
              Poll GitHub issues labeled factory
            </label>
            <div className="space-y-1.5">
              <Label>Rotate GitHub PAT</Label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder="ghp_…"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                />
                <Button disabled={!pat || rotate.isPending} onClick={() => rotate.mutate({ id, githubPat: pat })}>
                  Save
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              LLM model comes from <code>OPENAI_COMPAT_MODEL</code> (default grok-4.5). Keys stay in env.
            </p>
          </CardContent>
        </Card>
      </main>
      </AgentGate>
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
