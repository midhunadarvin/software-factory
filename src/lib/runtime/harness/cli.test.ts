import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDashModelList, startCliSession } from "./cli";
import { fixtureFr } from "../fixtures";

const g = globalThis as typeof globalThis & { __factorySessions?: unknown };

describe("startCliSession", () => {
  let dir = "";

  afterEach(() => {
    g.__factorySessions = undefined;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("streams JSON lines and exits 0", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-cli-"));
    const fake = path.join(dir, "fake-claude.mjs");
    const fr = fixtureFr("streamed");
    fs.writeFileSync(
      fake,
      `
import fs from "node:fs";
import path from "node:path";
console.log(JSON.stringify({ type: "assistant", session_id: "s1", message: { content: [{ type: "text", text: "working" }] } }));
const issueDir = path.join(process.cwd(), ".factory", "issues", "1");
fs.mkdirSync(issueDir, { recursive: true });
fs.writeFileSync(path.join(issueDir, "fr.json"), ${JSON.stringify(JSON.stringify(fr))});
`,
    );
    const session = startCliSession({
      binary: process.execPath,
      args: [fake],
      req: {
        jobId: "job-1",
        projectId: "proj-1",
        laneId: "requirements",
        cwd: dir,
        brief: "write the FR",
        userPrompt: "write the FR",
        context: null,
        artifact: "fr",
      },
      promptArg: true,
    });
    const out = await session.result;
    expect(out.code).toBe(0);
    expect(out.sessionId).toBe("s1");
    expect(out.text).toContain("working");
    expect(fs.existsSync(path.join(dir, ".factory", "issues", "1", "fr.json"))).toBe(true);
  });

  it("fails when the CLI emits no model tokens in time", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-cli-"));
    const fake = path.join(dir, "silent.mjs");
    fs.writeFileSync(fake, `await new Promise((r) => setTimeout(r, 400));`);
    const session = startCliSession({
      binary: process.execPath,
      args: [fake],
      firstTokenMs: 40,
      req: {
        jobId: "job-timeout",
        projectId: "proj-1",
        laneId: "triage",
        cwd: dir,
        brief: "triage",
        userPrompt: "triage",
        context: null,
      },
      promptArg: true,
    });
    const out = await session.result;
    expect(out.code).toBe(1);
    expect(out.text).toMatch(/No tokens from the model within /);
  });

  it("fails when the CLI goes silent after the first token", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-cli-"));
    const fake = path.join(dir, "idle.mjs");
    fs.writeFileSync(
      fake,
      `
console.log(JSON.stringify({ type: "assistant", session_id: "s-idle", message: { content: [{ type: "text", text: "working" }] } }));
await new Promise((r) => setTimeout(r, 400));
`,
    );
    const session = startCliSession({
      binary: process.execPath,
      args: [fake],
      firstTokenMs: 5_000,
      idleMs: 40,
      req: {
        jobId: "job-idle",
        projectId: "proj-1",
        laneId: "implementation",
        cwd: dir,
        brief: "implement",
        userPrompt: "implement",
        context: null,
      },
      promptArg: true,
    });
    const out = await session.result;
    expect(out.code).toBe(1);
    expect(out.text).toMatch(/No output from the coding CLI for /);
  });
});

describe("parseDashModelList", () => {
  it("parses cursor-agent --list-models lines", () => {
    const listed = parseDashModelList(`Available models

auto - Auto (default)
gpt-5.3-codex-low - Codex 5.3 Low
cursor-grok-4.6-high - Grok 4.6
`);
    expect(listed.defaultModel).toBe("auto");
    expect(listed.models).toEqual([
      { id: "auto", name: "Auto" },
      { id: "gpt-5.3-codex-low", name: "Codex 5.3 Low" },
      { id: "cursor-grok-4.6-high", name: "Grok 4.6" },
    ]);
  });
});
