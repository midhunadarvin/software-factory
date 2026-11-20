import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeStore, getStore } from "../..";
import type { NewJob } from "../../models";

const NOW = "2026-01-01T00:00:00.000Z";

function job(id: string, patch: Partial<NewJob> = {}): NewJob {
  return {
    id,
    projectId: "p1",
    issueNumber: -1,
    issueTitle: id,
    state: "intake",
    lastActiveState: "intake",
    boardColumn: "intake",
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

describe("sqlite DataStore", () => {
  let tmp = "";
  const prevRoot = process.env.FACTORY_ROOT;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "factory-store-"));
    process.env.FACTORY_ROOT = tmp;
    closeStore();
    const store = getStore();
    await store.migrate();
    await store.projects.insert({
      id: "p1",
      name: "demo",
      rootPath: tmp,
      source: "local_folder",
      remoteKind: "none",
      defaultBranch: "main",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  afterEach(() => {
    closeStore();
    if (prevRoot === undefined) delete process.env.FACTORY_ROOT;
    else process.env.FACTORY_ROOT = prevRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("finds projects by id and root path", async () => {
    const store = getStore();
    expect((await store.projects.get("p1"))?.name).toBe("demo");
    expect((await store.projects.getByRootPath(tmp))?.id).toBe("p1");
    await store.projects.update("p1", { name: "renamed" });
    expect((await store.projects.list()).map((p) => p.name)).toEqual(["renamed"]);
  });

  it("hides archived jobs unless asked and numbers local tickets downward", async () => {
    const { jobs } = getStore();
    expect(await jobs.nextLocalIssueNumber("p1")).toBe(-1);
    await jobs.insert(job("a", { issueNumber: -1 }));
    await jobs.insert(job("b", { issueNumber: -2, archivedAt: NOW }));
    expect(await jobs.nextLocalIssueNumber("p1")).toBe(-3);
    expect((await jobs.list({ projectId: "p1" })).map((j) => j.id)).toEqual(["a"]);
    expect(await jobs.list({ projectId: "p1", includeArchived: true })).toHaveLength(2);
  });

  it("matches active jobs by external key and issue number", async () => {
    const { jobs } = getStore();
    await jobs.insert(job("gh", { issueNumber: 7, externalKey: "github:7" }));
    expect((await jobs.findActiveByExternalKey("p1", "github:7"))?.id).toBe("gh");
    expect((await jobs.findActiveByIssueNumber("p1", 7))?.id).toBe("gh");
    await jobs.update("gh", { archivedAt: NOW });
    expect(await jobs.findActiveByExternalKey("p1", "github:7")).toBeUndefined();
  });

  it("compare-and-sets job state", async () => {
    const { jobs } = getStore();
    await jobs.insert(job("a", { state: "awaiting_tasks_approval" }));
    expect(await jobs.updateIfState("a", "awaiting_tasks_approval", { state: "implementation" })).toBe(true);
    expect(await jobs.updateIfState("a", "awaiting_tasks_approval", { state: "done" })).toBe(false);
    expect((await jobs.get("a"))?.state).toBe("implementation");
  });

  it("releases and lists leases", async () => {
    const { jobs } = getStore();
    await jobs.insert(job("a", { lockedBy: "123", lockedAt: "2026-01-01T00:00:00.000Z" }));
    await jobs.insert(job("b", { issueNumber: -2, lockedBy: "456", lockedAt: "2026-01-02T00:00:00.000Z" }));
    expect((await jobs.listLockedBefore("2026-01-01T12:00:00.000Z")).map((j) => j.id)).toEqual(["a"]);
    await jobs.releaseLocksHeldBy("123");
    expect((await jobs.get("a"))?.lockedBy).toBeNull();
    expect((await jobs.get("b"))?.lockedBy).toBe("456");
  });

  it("versions artifacts per kind and deletes selected kinds", async () => {
    const store = getStore();
    await store.jobs.insert(job("a"));
    const v1 = await store.artifacts.append({ jobId: "a", kind: "fr", source: "agent", body: "{}" });
    const v2 = await store.artifacts.append({ jobId: "a", kind: "fr", source: "human", body: '{"x":1}' });
    await store.artifacts.append({ jobId: "a", kind: "triage", source: "agent", body: "{}" });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect((await store.artifacts.latest("a", "fr"))?.body).toBe('{"x":1}');
    await store.artifacts.deleteKinds("a", ["fr"]);
    expect(await store.artifacts.latest("a", "fr")).toBeUndefined();
    expect((await store.artifacts.listByJob("a")).map((r) => r.kind)).toEqual(["triage"]);
  });

  it("returns recent events newest first", async () => {
    const { events } = getStore();
    for (const [id, at] of [
      ["e1", "2026-01-01T00:00:01.000Z"],
      ["e2", "2026-01-01T00:00:02.000Z"],
    ] as const) {
      await events.insert({ id, jobId: "a", projectId: "p1", level: "info", event: "x", payload: "{}", createdAt: at });
    }
    expect((await events.recentForProject("p1", 10)).map((e) => e.id)).toEqual(["e2", "e1"]);
    expect((await events.listByJob("a", 1)).map((e) => e.id)).toEqual(["e2"]);
    expect((await events.forProjectAfter("p1", "e1")).map((e) => e.id)).toEqual(["e2"]);
  });

  it("rejects an unknown driver", () => {
    closeStore();
    process.env.FACTORY_DB = "nope";
    try {
      expect(() => getStore()).toThrow(/Unknown FACTORY_DB driver "nope"/);
    } finally {
      delete process.env.FACTORY_DB;
    }
  });
});
