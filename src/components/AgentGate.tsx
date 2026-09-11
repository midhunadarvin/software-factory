"use client";

import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AgentGate({ children }: { children: ReactNode }) {
  const status = trpc.agent.status.useQuery(undefined, { refetchInterval: 8000 });
  if (status.isLoading) {
    return <p className="p-8 text-sm text-muted-foreground">Checking agent connection…</p>;
  }
  const agent = status.data;
  if (agent?.ready) return <>{children}</>;
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <Card className="border-amber-200">
        <CardHeader>
          <div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-amber-50 text-amber-800">
            <TriangleAlert className="size-4" />
          </div>
          <CardTitle>Agent not configured</CardTitle>
          <CardDescription>
            Repos, jobs, and lane agents stay locked until an OpenAI-compatible API key works.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-destructive">{agent?.error ?? "Unknown agent error"}</p>
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>
              Set <code className="rounded bg-muted px-1">XAI_API_KEY</code> or{" "}
              <code className="rounded bg-muted px-1">OPENAI_API_KEY</code> in{" "}
              <code className="rounded bg-muted px-1">.env</code>
            </li>
            <li>
              Optional: <code className="rounded bg-muted px-1">OPENAI_COMPAT_BASE_URL</code> must be the{" "}
              <code className="rounded bg-muted px-1">/v1</code> root (default{" "}
              {agent?.baseUrl ?? "https://api.x.ai/v1"}; OpenCode Go is{" "}
              <code className="rounded bg-muted px-1">https://opencode.ai/zen/go/v1</code>
              — do not append <code className="rounded bg-muted px-1">/chat/completions</code>) and{" "}
              <code className="rounded bg-muted px-1">OPENAI_COMPAT_MODEL</code> (default{" "}
              {agent?.model ?? "grok-4.5"})
            </li>
            <li>Restart the factory process so it reloads the environment</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
