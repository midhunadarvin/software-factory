"use client";

import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { HarnessId } from "@/lib/runtime/harness/types";

export function HarnessSettings({
  projectId,
  value,
}: {
  projectId: string;
  value: { default: HarnessId; byLane: Partial<Record<string, HarnessId>> };
}) {
  const status = trpc.projects.harnessStatus.useQuery();
  const update = trpc.projects.update.useMutation();
  const utils = trpc.useUtils();
  const rows = status.data?.harnesses ?? [];

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Lane agent harness</CardTitle>
        <CardDescription>
          Each lane runs a terminal CLI (`claude`, `cursor-agent`, `codex`) in the job worktree when that
          binary is on PATH. In-process is the fallback and needs an LLM API key. The factory still owns
          the pipeline, brief, and Approve.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="harness-default">Default harness</Label>
          <select
            id="harness-default"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={value.default}
            onChange={(e) => {
              const next = e.target.value as HarnessId;
              update.mutate(
                { id: projectId, harness: { default: next, byLane: value.byLane } },
                { onSuccess: () => void utils.projects.get.invalidate({ id: projectId }) },
              );
            }}
          >
            {rows.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
                {h.detect.ok ? "" : " (not on PATH)"}
              </option>
            ))}
            {rows.length === 0 && <option value={value.default}>{value.default}</option>}
          </select>
        </div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {rows.map((h) => (
            <li key={h.id}>
              <span className="font-medium text-foreground">{h.label}:</span> {h.description}
              {h.detect.ok ? "" : ` — ${"error" in h.detect ? h.detect.error : ""}`}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
