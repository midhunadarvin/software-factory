import { and, eq, isNull, sql } from "drizzle-orm";
import type { JobRepo } from "../../repositories";
import type { SqliteDb } from "./client";
import { jobs } from "./schema";

export function sqliteJobs(db: () => SqliteDb): JobRepo {
  return {
    async get(id) {
      return (await db().select().from(jobs).where(eq(jobs.id, id)).limit(1))[0];
    },
    async list(filter = {}) {
      const where = and(
        filter.projectId ? eq(jobs.projectId, filter.projectId) : undefined,
        filter.includeArchived ? undefined : isNull(jobs.archivedAt),
      );
      return db().select().from(jobs).where(where);
    },
    async findActiveByExternalKey(projectId, externalKey) {
      return (
        await db()
          .select()
          .from(jobs)
          .where(and(eq(jobs.projectId, projectId), eq(jobs.externalKey, externalKey), isNull(jobs.archivedAt)))
          .limit(1)
      )[0];
    },
    async findActiveByIssueNumber(projectId, issueNumber) {
      return (
        await db()
          .select()
          .from(jobs)
          .where(and(eq(jobs.projectId, projectId), eq(jobs.issueNumber, issueNumber), isNull(jobs.archivedAt)))
          .limit(1)
      )[0];
    },
    async insert(job) {
      await db().insert(jobs).values(job);
    },
    async update(id, patch) {
      await db().update(jobs).set(patch).where(eq(jobs.id, id));
    },
    async updateIfState(id, expectedState, patch) {
      const res = await db()
        .update(jobs)
        .set(patch)
        .where(and(eq(jobs.id, id), eq(jobs.state, expectedState)));
      return res.changes > 0;
    },
    async nextLocalIssueNumber(projectId) {
      const row = await db()
        .select({ n: sql<number>`coalesce(min(${jobs.issueNumber}), 0)` })
        .from(jobs)
        .where(and(eq(jobs.projectId, projectId), sql`${jobs.issueNumber} < 0`));
      return Number(row[0]?.n ?? 0) - 1;
    },
    async releaseLocksHeldBy(owner) {
      await db().update(jobs).set({ lockedAt: null, lockedBy: null }).where(eq(jobs.lockedBy, owner));
    },
    async listLockedBefore(cutoffIso) {
      return db().select().from(jobs).where(sql`locked_at IS NOT NULL AND locked_at < ${cutoffIso}`);
    },
    async deleteByProject(projectId) {
      await db().delete(jobs).where(eq(jobs.projectId, projectId));
    },
  };
}
