import { and, desc, eq, gt } from "drizzle-orm";
import type { EventRepo } from "../../repositories";
import type { SqliteDb } from "./client";
import { agentEvents } from "./schema";

export function sqliteEvents(db: () => SqliteDb): EventRepo {
  return {
    async insert(event) {
      await db().insert(agentEvents).values(event);
    },
    async listByJob(jobId, limit) {
      return db()
        .select()
        .from(agentEvents)
        .where(eq(agentEvents.jobId, jobId))
        .orderBy(desc(agentEvents.createdAt))
        .limit(limit);
    },
    async recentForProject(projectId, limit) {
      return db()
        .select()
        .from(agentEvents)
        .where(eq(agentEvents.projectId, projectId))
        .orderBy(desc(agentEvents.createdAt))
        .limit(limit);
    },
    async forProjectAfter(projectId, afterId) {
      return db()
        .select()
        .from(agentEvents)
        .where(and(eq(agentEvents.projectId, projectId), gt(agentEvents.id, afterId)));
    },
  };
}
