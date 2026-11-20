import { eq } from "drizzle-orm";
import type { ProjectRepo } from "../../repositories";
import type { SqliteDb } from "./client";
import { projects } from "./schema";

export function sqliteProjects(db: () => SqliteDb): ProjectRepo {
  return {
    async get(id) {
      return (await db().select().from(projects).where(eq(projects.id, id)).limit(1))[0];
    },
    async getByRootPath(rootPath) {
      return (await db().select().from(projects).where(eq(projects.rootPath, rootPath)).limit(1))[0];
    },
    async list() {
      return db().select().from(projects);
    },
    async insert(project) {
      await db().insert(projects).values(project);
    },
    async update(id, patch) {
      await db().update(projects).set(patch).where(eq(projects.id, id));
    },
    async delete(id) {
      await db().delete(projects).where(eq(projects.id, id));
    },
  };
}
