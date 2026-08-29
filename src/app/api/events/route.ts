import { and, desc, eq, gt } from "drizzle-orm";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { agentEvents, projects } from "@/lib/db/schema";
import { bus } from "@/lib/runtime/events";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!verifySession(match?.[1])) {
    return new Response("unauthorized", { status: 401 });
  }
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return new Response("projectId required", { status: 400 });
  const p = (await getDb().select().from(projects).where(eq(projects.id, projectId)))[0];
  if (!p) return new Response("not found", { status: 404 });

  const last = req.headers.get("last-event-id");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (id: string, type: string, data: unknown) => {
        controller.enqueue(encoder.encode(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const db = getDb();
      const replay = last
        ? await db
            .select()
            .from(agentEvents)
            .where(and(eq(agentEvents.projectId, projectId), gt(agentEvents.id, last)))
        : await db
            .select()
            .from(agentEvents)
            .where(eq(agentEvents.projectId, projectId))
            .orderBy(desc(agentEvents.createdAt))
            .limit(50)
            .then((r) => r.reverse());
      for (const e of replay) {
        send(e.id, e.event, { payload: e.payload, jobId: e.jobId });
      }
      const onEvent = (e: { id: string; type: string; data: unknown; projectId: string }) => {
        if (e.projectId !== projectId) return;
        send(e.id, e.type, e.data);
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
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
