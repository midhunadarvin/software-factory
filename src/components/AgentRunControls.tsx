"use client";

import { useState } from "react";
import { Square, RotateCcw } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RESTART_STEPS } from "@/lib/runtime/lanes";

export function AgentRunControls({
  jobId,
  running,
  defaultStep,
  steps,
}: {
  jobId: string;
  running: boolean;
  defaultStep?: string;
  steps?: readonly { id: string; label: string }[];
}) {
  const utils = trpc.useUtils();
  const restartSteps = steps?.length ? steps : RESTART_STEPS;
  const [step, setStep] = useState(defaultStep && restartSteps.some((s) => s.id === defaultStep) ? defaultStep : restartSteps[0]?.id ?? "planning");
  const stop = trpc.jobs.stop.useMutation({
    onSuccess: () => {
      void utils.jobs.get.invalidate({ id: jobId });
      void utils.jobs.session.invalidate({ id: jobId });
      void utils.jobs.list.invalidate();
    },
  });
  const restart = trpc.jobs.restartFrom.useMutation({
    onSuccess: () => {
      void utils.jobs.get.invalidate({ id: jobId });
      void utils.jobs.session.invalidate({ id: jobId });
      void utils.jobs.list.invalidate();
    },
  });
  const busy = stop.isPending || restart.isPending;
  return (
    <div className="flex flex-col gap-3">
      {running && (
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => stop.mutate({ id: jobId })}
        >
          <Square />
          {stop.isPending ? "Stopping…" : "Stop agent"}
        </Button>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`restart-${jobId}`}>Restart from step</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            id={`restart-${jobId}`}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm"
            value={step}
            disabled={busy}
            onChange={(e) => setStep(e.target.value)}
          >
            {restartSteps.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              restart.mutate({
                id: jobId,
                step,
              })
            }
          >
            <RotateCcw />
            {restart.isPending ? "Restarting…" : running ? "Stop and restart" : "Restart"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Stops the current run if needed, deletes later artifacts and context, and starts at that lane. Restart from Intake parks the ticket without starting an agent.
        </p>
      </div>
      {stop.error && <p className="text-sm text-destructive">{stop.error.message}</p>}
      {restart.error && <p className="text-sm text-destructive">{restart.error.message}</p>}
    </div>
  );
}
