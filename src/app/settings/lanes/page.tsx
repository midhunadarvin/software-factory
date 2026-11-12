"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { AppHeader } from "@/components/AppChrome";
import { AgentGate } from "@/components/AgentGate";
import { PipelineEditor } from "@/components/PipelineEditor";
import { SettingsNav } from "@/components/SettingsNav";
import { Button } from "@/components/ui/button";
import { DEFAULT_PIPELINE } from "@/lib/runtime/pipeline/default";

function LanesSettingsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("project") ?? "";
  const project = trpc.projects.get.useQuery({ id }, { enabled: Boolean(id) });
  const updatePipeline = trpc.projects.updatePipeline.useMutation({
    onSuccess: () => project.refetch(),
  });
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
        <main className="mx-auto max-w-4xl px-4 py-10">
          <p className="mb-2 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
            02 · Project
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Lanes and actions</h1>
          <SettingsNav projectId={id} current="lanes" />
          <div className="mt-8">
            <PipelineEditor
              key={p.pipelineCustom ? "custom" : "default"}
              value={p.pipeline ?? DEFAULT_PIPELINE}
              defaultPipeline={DEFAULT_PIPELINE}
              custom={Boolean(p.pipelineCustom)}
              saving={updatePipeline.isPending}
              error={updatePipeline.error?.message}
              showHeading={false}
              onSave={(pipeline) => updatePipeline.mutate({ id, pipeline })}
              onReset={() => updatePipeline.mutate({ id, pipeline: null })}
            />
          </div>
        </main>
      </AgentGate>
    </div>
  );
}

export default function LanesSettingsPage() {
  return (
    <Suspense>
      <LanesSettingsInner />
    </Suspense>
  );
}
