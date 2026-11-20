import type { DataStore } from "./repositories";
import { createSqliteStore } from "./drivers/sqlite";

export type * from "./models";
export type * from "./repositories";

const drivers: Record<string, () => DataStore> = {
  sqlite: createSqliteStore,
};

let store: DataStore | null = null;

export function dataDriver(): string {
  return (process.env.FACTORY_DB ?? "sqlite").trim().toLowerCase() || "sqlite";
}

export function getStore(): DataStore {
  if (store) return store;
  const id = dataDriver();
  const create = drivers[id];
  if (!create) throw new Error(`Unknown FACTORY_DB driver "${id}" (available: ${Object.keys(drivers).join(", ")})`);
  store = create();
  return store;
}

export function closeStore() {
  store?.close();
  store = null;
}
