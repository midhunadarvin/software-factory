import { getStore } from "../data";
import type { ArtifactKind } from "./schemas";

export async function loadLatestArtifact(jobId: string, kind: ArtifactKind) {
  const row = await getStore().artifacts.latest(jobId, kind);
  if (!row) return null;
  return { ...row, parsed: JSON.parse(row.body) as unknown };
}

export async function writeArtifact(opts: {
  jobId: string;
  kind: ArtifactKind;
  source: "agent" | "human";
  body: unknown;
}) {
  const row = await getStore().artifacts.append({
    jobId: opts.jobId,
    kind: opts.kind,
    source: opts.source,
    body: JSON.stringify(opts.body),
  });
  return { id: row.id, version: row.version, body: row.body };
}
