import { getDb } from "../db/client";
import { projects } from "../db/schema";
import { matchProject } from "../integrations/match";
import type { IncomingIssue } from "../integrations/types";
import { logEvent } from "../runtime/events";
import { getRuntime } from "../runtime";

export { readRawBody } from "../integrations/dispatch";

export async function ingestIncomingIssue(issue: IncomingIssue): Promise<{
  ok: true;
  ignored?: string;
  id?: string;
  created?: boolean;
  triaged?: boolean;
}> {
  const rows = await getDb().select().from(projects);
  const hit = matchProject(issue, rows);
  if (!hit) {
    return { ok: true, ignored: "no matching project" };
  }
  const result = await getRuntime().ingestExternalIssue({
    projectId: hit.project.id,
    source: issue.source,
    externalKey: issue.externalKey,
    issueNumber: issue.issueNumber,
    title: issue.title,
    body: issue.body,
    url: issue.url,
    autoTriage: hit.intake.autoTriage,
  });
  await logEvent({
    projectId: hit.project.id,
    jobId: result.id,
    event: result.created ? "webhook.ingested" : "webhook.duplicate",
    payload: { source: issue.source, externalKey: issue.externalKey, triaged: result.triaged },
  });
  return { ok: true, ...result };
}
