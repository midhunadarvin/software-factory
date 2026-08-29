import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { factorySqlitePath, varDir } from "../paths";
import * as schema from "./schema";

let sqlite: Database.Database | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getSqlite(): Database.Database {
  if (sqlite) return sqlite;
  varDir();
  sqlite = new Database(factorySqlitePath());
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

export function getDb() {
  if (db) return db;
  db = drizzle(getSqlite(), { schema });
  return db;
}

export function closeDb() {
  sqlite?.close();
  sqlite = null;
  db = null;
}

export type FactoryDb = ReturnType<typeof getDb>;
