import type { DataStore } from "../../repositories";
import { closeSqlite, getDb, getSqlite } from "./client";
import { openSqliteCheckpointer } from "./checkpointer";
import { migrate } from "./migrate";
import { sqliteArtifacts } from "./artifacts";
import { sqliteEvents } from "./events";
import { sqliteJobs } from "./jobs";
import { sqliteProjects } from "./projects";

export function createSqliteStore(): DataStore {
  return {
    driver: "sqlite",
    projects: sqliteProjects(getDb),
    jobs: sqliteJobs(getDb),
    artifacts: sqliteArtifacts(getDb),
    events: sqliteEvents(getDb),
    async migrate() {
      migrate();
    },
    async ping() {
      getSqlite().prepare("SELECT 1").get();
    },
    checkpointer: openSqliteCheckpointer,
    close: closeSqlite,
  };
}
