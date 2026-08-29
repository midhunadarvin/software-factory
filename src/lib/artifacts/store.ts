import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/client";
import { artifacts } from "../db/schema";
import { nowIso } from "../paths";
import type { ArtifactKind } from "./schemas";

export async function loadLatestArtifact(jobId: string, kind: ArtifactKind) {
  const db = getDb();
  const rows = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.jobId, jobId), eq(artifacts.kind, kind)))
    .orderBy(desc(artifacts.version))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, parsed: JSON.parse(row.body) as unknown };
}

export async function writeArtifact(opts: {
  jobId: string;
  kind: ArtifactKind;
  source: "agent" | "human";
  body: unknown;
}) {
  const db = getDb();
  const latest = await loadLatestArtifact(opts.jobId, opts.kind);
  const version = (latest?.version ?? 0) + 1;
  const id = randomUUID();
  const json = JSON.stringify(opts.body);
  await db.insert(artifacts).values({
    id,
    jobId: opts.jobId,
    kind: opts.kind,
    version,
    source: opts.source,
    body: json,
    createdAt: nowIso(),
  });
  return { id, version, body: json };
}
