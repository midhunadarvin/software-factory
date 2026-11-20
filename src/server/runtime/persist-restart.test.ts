import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeStore, getStore } from "../data";
import { nowIso } from "../../utils/paths";
import { DEFAULT_PIPELINE } from "../pipeline/default";
import { FactoryRuntime } from "./index";
import { getSession, startSession, appendSession, finishSession } from "../agents/session-store";

describe("pipeline state survives a process restart", () => {
  let tmp = "";
  const prevRoot = process.env.FACTORY_ROOT;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "factory-persist-"));
    process.env.FACTORY_ROOT = tmp;
    closeStore();
    await getStore().migrate();
    const g = globalThis as typeof globalThis & { __factorySessions?: unknown };
    g.__factorySessions = undefined;
  });

  afterEach(() => {
    closeStore();
    const g = globalThis as typeof globalThis & { __factorySessions?: unknown };
    g.__factorySessions = undefined;
    if (prevRoot === undefined) delete process.env.FACTORY_ROOT;
    else process.env.FACTORY_ROOT = prevRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function seedParkedJob() {
    const store = getStore();
    const now = nowIso();
    await store.projects.insert({
      id: "proj-1",
      name: "software-factory",
      rootPath: tmp,
      source: "local_folder",
      remoteKind: "none",
      defaultBranch: "main",
      pipeline: JSON.stringify(DEFAULT_PIPELINE),
      createdAt: now,
      updatedAt: now,
    });
    await store.jobs.insert({
      id: "job-parked",
      projectId: "proj-1",
      issueNumber: -1,
      issueTitle: "Parked ticket",
      issueBody: "do not move me",
      state: "awaiting_requirements_approval",
      lastActiveState: "requirements",
      boardColumn: "planning",
      pendingArtifact: JSON.stringify({ version: 1, summary: "keep" }),
      createdAt: now,
      updatedAt: now,
    });
    await store.artifacts.insert({
      id: "art-1",
      jobId: "job-parked",
      kind: "fr",
      version: 1,
      source: "agent",
      body: JSON.stringify({ version: 1, summary: "keep" }),
      createdAt: now,
    });
  }

  it("reopens jobs, artifacts, and pipeline config from sqlite after closeStore", async () => {
    await seedParkedJob();
    closeStore();

    const store = getStore();
    const project = await store.projects.get("proj-1");
    const job = await store.jobs.get("job-parked");
    const arts = await store.artifacts.listByJob("job-parked");
    expect(project?.pipeline).toContain("tech_spec");
    expect(job?.state).toBe("awaiting_requirements_approval");
    expect(job?.boardColumn).toBe("planning");
    expect(job?.pendingArtifact).toContain("keep");
    expect(arts).toHaveLength(1);
    expect(arts[0]?.kind).toBe("fr");
  });

  it("reloads agent session transcripts after in-memory cache is dropped", () => {
    startSession("job-parked", "proj-1", "requirements", "grok-4.5");
    appendSession("job-parked", "thinking", "drafting FR-1");
    finishSession("job-parked", "done");
    const g = globalThis as typeof globalThis & { __factorySessions?: unknown };
    g.__factorySessions = undefined;
    const s = getSession("job-parked");
    expect(s?.lane).toBe("requirements");
    expect(s?.thinking).toContain("drafting FR-1");
    expect(s?.status).toBe("done");
    expect(s?.model).toBe("grok-4.5");
  });

  it("recoverJobs leaves parked approval tickets on the same lane", async () => {
    await seedParkedJob();
    const now = nowIso();
    await getStore().jobs.insert({
      id: "job-intake",
      projectId: "proj-1",
      issueNumber: -2,
      issueTitle: "Stay in intake",
      issueBody: "",
      state: "intake",
      lastActiveState: "intake",
      boardColumn: "intake",
      createdAt: now,
      updatedAt: now,
    });

    const rt = new FactoryRuntime();
    const invoked: string[] = [];
    rt.invokeJob = (async (job) => {
      invoked.push(job.id);
    }) as FactoryRuntime["invokeJob"];
    rt.checkpointer = {
      getTuple: async () => ({ checkpoint: true }),
    } as never;
    rt.graphForJob = (async () => ({
      getState: async () => ({ tasks: [{ interrupts: [{ value: "gate" }] }] }),
    })) as never;

    await rt.recoverJobs();
    const parked = await getStore().jobs.get("job-parked");
    const intake = await getStore().jobs.get("job-intake");
    expect(parked?.state).toBe("awaiting_requirements_approval");
    expect(parked?.boardColumn).toBe("planning");
    expect(intake?.state).toBe("intake");
    expect(invoked).toEqual([]);
  });
});
