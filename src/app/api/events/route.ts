import { SESSION_COOKIE, verifySession } from "@/utils/auth/session";
import { getStore } from "@/server/data";
import { bus } from "@/server/runtime/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!verifySession(match?.[1])) {
    return new Response("unauthorized", { status: 401 });
  }
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const jobId = url.searchParams.get("jobId");
  if (!projectId) return new Response("projectId required", { status: 400 });
  const p = await getStore().projects.get(projectId);
  if (!p) return new Response("not found", { status: 404 });

  const last = req.headers.get("last-event-id");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (id: string, type: string, data: unknown) => {
        controller.enqueue(encoder.encode(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const events = getStore().events;
      const replay = last
        ? await events.forProjectAfter(projectId, last)
        : (await events.recentForProject(projectId, 50)).reverse();
      for (const e of replay) {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(e.payload) as Record<string, unknown>;
        } catch {
          parsed = { payload: e.payload };
        }
        send(e.id, e.event, { ...parsed, jobId: e.jobId });
      }
      if (jobId) {
        const { getSession } = await import("@/server/agents/session-store");
        const live = getSession(jobId);
        if (live) send(`session-${jobId}`, "agent.session", live);
      }
      const onEvent = (e: {
        id: string;
        type: string;
        data: unknown;
        projectId: string;
        jobId?: string | null;
      }) => {
        if (e.projectId !== projectId) return;
        const data =
          e.data && typeof e.data === "object"
            ? { jobId: e.jobId, ...(e.data as object) }
            : { jobId: e.jobId, payload: e.data };
        send(e.id, e.type, data);
      };
      bus.on(`project:${projectId}`, onEvent);
      const keep = setInterval(() => controller.enqueue(encoder.encode(`: ping\n\n`)), 15_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(keep);
        bus.off(`project:${projectId}`, onEvent);
        controller.close();
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
