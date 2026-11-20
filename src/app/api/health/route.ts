import { getStore } from "@/server/data";
import { gitOk } from "@/utils/git/exec";
import { getAgentStatus } from "@/server/agents/status";

export const runtime = "nodejs";

export async function GET() {
  let dbOk = false;
  let count = 0;
  try {
    const store = getStore();
    await store.ping();
    count = (await store.projects.list()).length;
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
