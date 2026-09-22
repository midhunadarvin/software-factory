"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type Turn = {
  role: "user" | "agent";
  lane: string;
  text: string;
  at: string;
};

export function LaneChat({
  jobId,
  laneId,
  laneLabel,
  running,
}: {
  jobId: string;
  laneId: string;
  laneLabel: string;
  running: boolean;
}) {
  const utils = trpc.useUtils();
  const session = trpc.jobs.session.useQuery({ id: jobId }, { refetchInterval: 1500 });
  const steer = trpc.jobs.steer.useMutation({
    onSuccess: () => {
      void utils.jobs.session.invalidate({ id: jobId });
      void utils.jobs.get.invalidate({ id: jobId });
      void utils.jobs.artifacts.invalidate({ id: jobId });
      void utils.jobs.list.invalidate();
      setDraft("");
    },
  });
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const turns = ((session.data?.turns ?? []) as Turn[]).filter((t) => t.lane === laneId);
  const busy = running || steer.isPending || session.data?.status === "running";

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns.length, busy]);

  const send = () => {
    const message = draft.trim();
    if (!message || busy) return;
    steer.mutate({ id: jobId, message });
  };

  return (
    <Card className="border-violet-200 shadow-sm">
      <CardHeader>
        <p className="text-[11px] font-medium tracking-[0.14em] text-violet-700 uppercase">Chat</p>
        <CardTitle className="text-base">{laneLabel} agent</CardTitle>
        <CardDescription>
          Ask this agent to change the document. Approve when the plan in this lane is right.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div ref={scroller} className="max-h-56 space-y-2 overflow-auto rounded-md border border-border bg-muted/30 p-2">
          {turns.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              No messages yet. The first draft is in the document on the left.
            </p>
          )}
          {turns.map((t, i) => (
            <div
              key={`${t.at}-${i}`}
              className={
                t.role === "user"
                  ? "ml-6 rounded-md bg-card px-2 py-1.5 text-xs"
                  : "mr-6 rounded-md bg-violet-50 px-2 py-1.5 text-xs text-violet-950"
              }
            >
              <p className="mb-0.5 text-[10px] font-medium tracking-wide uppercase text-muted-foreground">
                {t.role === "user" ? "You" : laneLabel}
              </p>
              <p className="whitespace-pre-wrap leading-relaxed">{t.text}</p>
            </div>
          ))}
          {busy && (
            <p className="text-[11px] text-muted-foreground">
              {steer.isPending || session.data?.status === "running" ? "Agent is revising…" : "Working…"}
            </p>
          )}
        </div>
        <Textarea
          className="min-h-20 text-sm"
          placeholder={`Ask the ${laneLabel.toLowerCase()} agent to change this document…`}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button size="sm" disabled={busy || !draft.trim()} onClick={send}>
          <Send />
          {steer.isPending ? "Sending…" : "Send"}
        </Button>
        {steer.error && <p className="text-xs text-destructive">{steer.error.message}</p>}
      </CardContent>
    </Card>
  );
}
