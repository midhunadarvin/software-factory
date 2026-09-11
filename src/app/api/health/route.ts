import { getSqlite } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { gitOk } from "@/lib/git/exec";
import { getDb } from "@/lib/db/client";
import { getAgentStatus } from "@/lib/runtime/agent-status";

export const runtime = "nodejs";

export async function GET() {
  let dbOk = false;
  let count = 0;
  try {
    getSqlite();
    count = (await getDb().select().from(projects)).length;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const agent = await getAgentStatus();
  return Response.json({
    ok: dbOk && agent.ready,
    db: dbOk,
    llmConfigured: agent.configured,
    agent,
    secretConfigured: Boolean(process.env.FACTORY_SECRET),
    gitOk: await gitOk(),
    projects: count,
  });
}
