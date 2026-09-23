import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startCliSession } from "./cli";
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
});
