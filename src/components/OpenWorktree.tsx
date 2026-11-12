"use client";

import { FolderOpen } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const AFTER_PLANNING = new Set(["tech_spec", "tasks", "implementation", "pull_request", "done"]);

export function afterPlanningLane(column?: string | null, state?: string | null) {
  if (column && AFTER_PLANNING.has(column)) return true;
  const s = state ?? "";
  return /tech_spec|tasks|implementation|review|pull_request|^done$/.test(s);
}

export function OpenWorktreeButtons({
  jobId,
  path,
}: {
  jobId: string;
  path?: string | null;
}) {
  const openWorktree = trpc.jobs.openWorktree.useMutation();
  return (
    <div className="flex flex-col gap-2">
      {path ? (
        <p className="font-mono text-[11px] leading-relaxed break-all text-muted-foreground">{path}</p>
      ) : (
        <p className="text-sm text-muted-foreground">This ticket has no worktree yet.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={openWorktree.isPending || !path}
          onClick={() => openWorktree.mutate({ id: jobId, editor: "cursor" })}
        >
          <FolderOpen />
          Open in Cursor
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={openWorktree.isPending || !path}
          onClick={() => openWorktree.mutate({ id: jobId, editor: "vscode" })}
        >
          <FolderOpen />
          Open in VS Code
        </Button>
      </div>
      {openWorktree.error && <p className="text-sm text-destructive">{openWorktree.error.message}</p>}
    </div>
  );
}

export function OpenWorktreeCard({
  jobId,
  path,
  column,
  state,
}: {
  jobId: string;
  path?: string | null;
  column?: string | null;
  state?: string | null;
}) {
  if (!afterPlanningLane(column, state)) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Worktree</CardTitle>
        <CardDescription>
          Open this ticket’s files in Cursor or VS Code and edit them. Uncommitted changes are picked up when the PR is
          prepared.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OpenWorktreeButtons jobId={jobId} path={path} />
      </CardContent>
    </Card>
  );
}
