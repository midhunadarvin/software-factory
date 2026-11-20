import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { nowIso } from "../../../../utils/paths";
import type { ArtifactRepo } from "../../repositories";
import type { SqliteDb } from "./client";
import { artifacts } from "./schema";

export function sqliteArtifacts(db: () => SqliteDb): ArtifactRepo {
  const repo: ArtifactRepo = {
    async latest(jobId, kind) {
      return (
        await db()
          .select()
          .from(artifacts)
          .where(and(eq(artifacts.jobId, jobId), eq(artifacts.kind, kind)))
          .orderBy(desc(artifacts.version))
          .limit(1)
      )[0];
    },
    async listByJob(jobId) {
      return db().select().from(artifacts).where(eq(artifacts.jobId, jobId)).orderBy(desc(artifacts.createdAt));
    },
    async listByKind(kind) {
      return db().select().from(artifacts).where(eq(artifacts.kind, kind));
    },
    async append(input) {
      const latest = await repo.latest(input.jobId, input.kind);
      const row = { ...input, id: randomUUID(), version: (latest?.version ?? 0) + 1, createdAt: nowIso() };
      await db().insert(artifacts).values(row);
      return row;
    },
    async insert(artifact) {
      await db().insert(artifacts).values(artifact);
    },
    async deleteKinds(jobId, kinds) {
      if (!kinds.length) return;
      await db().delete(artifacts).where(and(eq(artifacts.jobId, jobId), inArray(artifacts.kind, kinds)));
    },
  };
  return repo;
}
