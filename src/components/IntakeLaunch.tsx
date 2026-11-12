"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function IntakeLaunch({
  jobId,
  currentModel,
  compact,
  className,
}: {
  jobId: string;
  currentModel?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const utils = trpc.useUtils();
  const catalog = trpc.agent.models.useQuery({ jobId });
  const send = trpc.jobs.sendToTriage.useMutation({
    onSuccess: () => {
      void utils.jobs.list.invalidate();
      void utils.jobs.get.invalidate({ id: jobId });
      void utils.jobs.session.invalidate({ id: jobId });
    },
  });
  const setModel = trpc.jobs.setModel.useMutation({
    onSuccess: () => {
      void utils.jobs.list.invalidate();
      void utils.jobs.get.invalidate({ id: jobId });
    },
  });
  const [model, setLocal] = useState("");
  const models = catalog.data?.models ?? [];
  const catalogIds = models.map((m) => m.id);
  useEffect(() => {
    const ids = catalog.data?.models.map((m) => m.id) ?? [];
    if (currentModel && (!ids.length || ids.includes(currentModel))) {
      setLocal(currentModel);
      return;
    }
    if (catalog.data?.defaultModel) setLocal(catalog.data.defaultModel);
  }, [currentModel, catalog.data]);
  const selected =
    (model && (!catalogIds.length || catalogIds.includes(model)) ? model : "") || catalog.data?.defaultModel || "";

  return (
    <div className={cn("flex flex-col gap-2", className)} onClick={(e) => e.stopPropagation()}>
      {!compact && (
        <Label htmlFor={`intake-model-${jobId}`} className="text-xs">
          Model for this ticket
          {catalog.data?.provider?.label ? ` · ${catalog.data.provider.label}` : ""}
        </Label>
      )}
      <select
        id={`intake-model-${jobId}`}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        value={selected}
        disabled={send.isPending || setModel.isPending}
        onChange={(e) => {
          const next = e.target.value;
          setLocal(next);
          setModel.mutate({ id: jobId, model: next });
        }}
      >
        {models.length === 0 && <option value="">Loading models…</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name ? `${m.name} (${m.id})` : m.id}
            {m.id === catalog.data?.defaultModel ? " (default)" : ""}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        className="h-8 w-full"
        disabled={!selected || send.isPending}
        onClick={() => send.mutate({ id: jobId, model: selected })}
      >
        <ArrowRight />
        {send.isPending ? "Sending…" : compact ? "Send to triage" : "Send to triage"}
      </Button>
      {send.error && <p className="text-xs text-destructive">{send.error.message}</p>}
    </div>
  );
}
