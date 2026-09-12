import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, getDb } from "../db/client";
import { migrate } from "../db/migrate";
import { artifacts, jobs, projects } from "../db/schema";
import { eq } from "drizzle-orm";
import { nowIso } from "../paths";
import { DEFAULT_PIPELINE } from "./pipeline/default";
import { FactoryRuntime } from "./index";
import { getSession, startSession, appendSession, finishSession } from "./session-store";

describe("pipeline state survives a process restart", () => {
  let tmp = "";
  const prevRoot = process.env.FACTORY_ROOT;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "factory-persist-"));
    process.env.FACTORY_ROOT = tmp;
    closeDb();
    migrate();
    const g = globalThis as typeof globalThis & { __factorySessions?: unknown };
    g.__factorySessions = undefined;
  });

  afterEach(() => {
    closeDb();
    const g = globalThis as typeof globalThis & { __factorySessions?: unknown };
    g.__factorySessions = undefined;
    if (prevRoot === undefined) delete process.env.FACTORY_ROOT;
    else process.env.FACTORY_ROOT = prevRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function seedParkedJob() {
    const db = getDb();
    const now = nowIso();
    await db.insert(projects).values({
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
    await db.insert(jobs).values({
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
    await db.insert(artifacts).values({
      id: "art-1",
      jobId: "job-parked",
      kind: "fr",
      version: 1,
      source: "agent",
      body: JSON.stringify({ version: 1, summary: "keep" }),
      createdAt: now,
    });
  }

  it("reopens jobs, artifacts, and pipeline config from sqlite after closeDb", async () => {
    await seedParkedJob();
    closeDb();

    const db = getDb();
    const project = (await db.select().from(projects).where(eq(projects.id, "proj-1")))[0];
    const job = (await db.select().from(jobs).where(eq(jobs.id, "job-parked")))[0];
    const arts = await db.select().from(artifacts).where(eq(artifacts.jobId, "job-parked"));
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
    await getDb().insert(jobs).values({
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
    const parked = (await getDb().select().from(jobs).where(eq(jobs.id, "job-parked")))[0];
    const intake = (await getDb().select().from(jobs).where(eq(jobs.id, "job-intake")))[0];
    expect(parked?.state).toBe("awaiting_requirements_approval");
    expect(parked?.boardColumn).toBe("planning");
    expect(intake?.state).toBe("intake");
    expect(invoked).toEqual([]);
  });
});
