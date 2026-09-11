import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { grep, listDir, readFile, replaceInFile, writeFile } from "./repo-tools";

const root = path.join(os.tmpdir(), `factory-repo-tools-${process.pid}`);

describe("repo-tools", () => {
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes, reads, greps, and replaces in the worktree", () => {
    writeFile(root, "src/app.js", "function add(a, b) {\n  return a + b;\n}\n");
    writeFile(root, "src/other.ts", "export const x = 1;\n");
    expect(listDir(root, ".", 2).some((p) => p.includes("app.js"))).toBe(true);
    expect(readFile(root, "src/app.js")).toContain("function add");
    expect(grep(root, { pattern: "return a \\+ b", path: "src" })).toMatch(/app\.js:2:/);
    expect(replaceInFile(root, "src/app.js", "a + b", "a - b")).toMatch(/replaced 1/);
    expect(readFile(root, "src/app.js")).toContain("a - b");
  });

  it("rejects path traversal", () => {
    expect(() => readFile(root, "../secret")).toThrow();
    expect(() => writeFile(root, "/etc/passwd", "x")).toThrow();
  });
});
