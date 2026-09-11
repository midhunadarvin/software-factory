import fs from "node:fs";
import { loadDotenv } from "../lib/load-dotenv";
import { invokePayloadPath } from "../lib/paths";
import { closeDb, getDb } from "../lib/db/client";
import { jobs } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { getRuntime } from "../lib/runtime";

// No top-level await: Node exits with code 13 ("unsettled top-level await")
// if the event loop empties while TLA is still pending (tsx + graph.invoke).

async function main() {
  loadDotenv();

  const jobId = process.argv[2];
  if (!jobId) {
    console.error("usage: run-job.ts <jobId>");
    process.exitCode = 2;
    return;
  }

  const runtime = getRuntime();
  await runtime.startWorker();

  const job = (await getDb().select().from(jobs).where(eq(jobs.id, jobId)))[0];
  if (!job) {
    console.error(`job not found: ${jobId}`);
    process.exitCode = 2;
    return;
  }

  let kind: "first" | "continue" | "resume" = "continue";
  let resume: unknown;
  let update: unknown;
  try {
    const payload = JSON.parse(fs.readFileSync(invokePayloadPath(jobId), "utf8")) as {
      kind?: "first" | "continue" | "resume";
      resume?: unknown;
      update?: unknown;
    };
    kind = payload.kind ?? "continue";
    resume = payload.resume;
    update = payload.update;
  } catch {
    kind = "continue";
  }

  try {
    await runtime.runGraph(job, kind, resume as never, update as never);
  } catch (err) {
    if (err instanceof Error && (err.name === "GraphInterrupt" || err.name === "AbortError")) {
      return;
    }
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

void main();
