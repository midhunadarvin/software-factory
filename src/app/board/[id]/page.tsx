"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ApprovalWorkspace } from "@/components/ApprovalWorkspace";

function JobInner() {
  const { id } = useParams<{ id: string }>();
  const projectId = useSearchParams().get("project") ?? "";
  return <ApprovalWorkspace jobId={id} projectId={projectId} />;
}

export default function JobPage() {
  return (
    <Suspense>
      <JobInner />
    </Suspense>
  );
}
