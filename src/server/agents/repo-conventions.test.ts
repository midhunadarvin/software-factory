import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONVENTION_MAX_CHARS,
  formatRepoConventions,
  loadRepoConventions,
} from "./repo-conventions";

describe("loadRepoConventions", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function tmp() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "factory-conv-"));
    dirs.push(d);
    return d;
  }

  it("returns null when no convention file exists", () => {
    expect(loadRepoConventions(tmp())).toBeNull();
    expect(formatRepoConventions(tmp())).toBe("");
    expect(formatRepoConventions(null)).toBe("");
  });

  it("prefers AGENTS.md over CONTRIBUTING.md", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "CONTRIBUTING.md"), "# contrib\n");
    fs.writeFileSync(path.join(d, "AGENTS.md"), "# agents\nDo not add Express.\n");
    const loaded = loadRepoConventions(d);
    expect(loaded?.path).toBe("AGENTS.md");
    expect(loaded?.body).toContain("Do not add Express");
    expect(formatRepoConventions(d)).toContain("from AGENTS.md");
    expect(formatRepoConventions(d)).toMatch(/authoritative/);
  });

  it("falls back to .factory/AGENTS.md then CONTRIBUTING.md", () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, ".factory"));
    fs.writeFileSync(path.join(d, ".factory", "AGENTS.md"), "factory-local\n");
    expect(loadRepoConventions(d)?.path).toBe(".factory/AGENTS.md");
    fs.rmSync(path.join(d, ".factory"), { recursive: true });
    fs.writeFileSync(path.join(d, "CONTRIBUTING.md"), "please lint\n");
    expect(loadRepoConventions(d)?.path).toBe("CONTRIBUTING.md");
  });

  it("truncates oversized convention files", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "AGENTS.md"), "x".repeat(CONVENTION_MAX_CHARS + 50));
    const loaded = loadRepoConventions(d);
    expect(loaded?.body.length).toBeLessThanOrEqual(CONVENTION_MAX_CHARS + 5);
    expect(loaded?.body.endsWith("…")).toBe(true);
  });
});
