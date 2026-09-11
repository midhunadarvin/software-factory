"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ApprovalWorkspace } from "@/components/ApprovalWorkspace";
import { AgentGate } from "@/components/AgentGate";

function JobInner() {
  const { id } = useParams<{ id: string }>();
  const projectId = useSearchParams().get("project") ?? "";
  return (
    <AgentGate>
      <ApprovalWorkspace jobId={id} projectId={projectId} />
    </AgentGate>
  );
}

export default function JobPage() {
  return (
    <Suspense>
      <JobInner />
    </Suspense>
  );
}
