import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { sessionFilePath } from "../paths";
import {
  appendSession,
  finishSession,
  getSession,
  getSessionBundle,
  startSession,
  stopSession,
  sessionWasStopped,
  trimSessionsFromStep,
} from "./session-store";

const JOB = "00000000-0000-4000-8000-000000000099";

describe("session-store", () => {
  afterEach(() => {
    const g = globalThis as typeof globalThis & { __factorySessions?: unknown };
    g.__factorySessions = undefined;
    try {
      fs.unlinkSync(sessionFilePath(JOB));
    } catch {
      /* ignore */
    }
  });

  it("persists a running session to disk so other processes can read it", () => {
    startSession(JOB, "proj", "triage", "glm-5.3-flash");
    appendSession(JOB, "thinking", "looking at test.js");
    finishSession(JOB, "done");
    const g = globalThis as typeof globalThis & { __factorySessions?: unknown };
    g.__factorySessions = undefined;
    const loaded = getSession(JOB);
    expect(loaded?.thinking).toContain("looking at test.js");
    expect(loaded?.status).toBe("done");
    expect(loaded?.model).toBe("glm-5.3-flash");
  });

  it("keeps prior lane sessions when a new lane starts", () => {
    startSession(JOB, "proj", "triage", "glm-5.3-flash");
    appendSession(JOB, "thinking", "risk is low");
    stopSession(JOB);
    startSession(JOB, "proj", "requirements", "glm-5.3-flash");
    appendSession(JOB, "text", "writing FRs");
    const g = globalThis as typeof globalThis & { __factorySessions?: unknown };
    g.__factorySessions = undefined;
    const bundle = getSessionBundle(JOB);
    expect(bundle.history).toHaveLength(1);
    expect(bundle.history[0]?.lane).toBe("triage");
    expect(bundle.history[0]?.thinking).toContain("risk is low");
    expect(bundle.current?.lane).toBe("requirements");
    expect(bundle.current?.text).toContain("writing FRs");
  });

  it("trims sessions from a step onward and keeps earlier thinking", () => {
    startSession(JOB, "proj", "triage");
    appendSession(JOB, "thinking", "triage notes");
    finishSession(JOB, "done");
    startSession(JOB, "proj", "requirements");
    appendSession(JOB, "thinking", "planning notes");
    finishSession(JOB, "done");
    startSession(JOB, "proj", "tech_spec");
    appendSession(JOB, "thinking", "spec notes");
    finishSession(JOB, "done");
    trimSessionsFromStep(JOB, "planning");
    const bundle = getSessionBundle(JOB);
    expect(bundle.history.map((h) => h.lane)).toEqual(["triage"]);
    expect(bundle.history[0]?.thinking).toContain("triage notes");
    expect(bundle.current).toBeNull();
  });

  it("marks a stopped session so the agent loop can exit", () => {
    startSession(JOB, "proj", "review");
    expect(sessionWasStopped(JOB)).toBe(false);
    stopSession(JOB, "operator");
    expect(sessionWasStopped(JOB)).toBe(true);
    expect(getSession(JOB)?.status).toBe("done");
  });

  it("trims from implementation without dropping planning history", () => {
    startSession(JOB, "proj", "triage");
    finishSession(JOB, "done");
    startSession(JOB, "proj", "requirements");
    finishSession(JOB, "done");
    startSession(JOB, "proj", "implementation");
    finishSession(JOB, "done");
    trimSessionsFromStep(JOB, "implementation");
    const bundle = getSessionBundle(JOB);
    expect(bundle.history.map((h) => h.lane)).toEqual(["triage", "requirements"]);
  });
});
