import { getSqlite } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { llmConfigured } from "@/lib/env";
import { gitOk } from "@/lib/git/exec";
import { getDb } from "@/lib/db/client";

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
  return Response.json({
    ok: dbOk,
    db: dbOk,
    llmConfigured: llmConfigured(),
    secretConfigured: Boolean(process.env.FACTORY_SECRET),
    gitOk: await gitOk(),
    projects: count,
  });
}
