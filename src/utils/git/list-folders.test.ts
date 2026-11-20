import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listFolders } from "./list-folders";

describe("listFolders", () => {
  it("lists child folders, flags git repos, and skips node_modules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "factory-folders-"));
    fs.mkdirSync(path.join(root, "app"));
    fs.mkdirSync(path.join(root, "repo", ".git"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.writeFileSync(path.join(root, "README.md"), "x");
    const r = listFolders(root);
    expect(r.dir).toBe(path.resolve(root));
    expect(r.entries.map((e) => e.name)).toEqual(["repo", "app"]);
    expect(r.entries[0]?.git).toBe(true);
    expect(r.entries[1]?.git).toBe(false);
    expect(r.parent).toBe(path.dirname(path.resolve(root)));
  });

  it("walks up from a missing path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "factory-folders-"));
    const r = listFolders(path.join(root, "nope", "missing"));
    expect(r.dir).toBe(path.resolve(root));
  });
});
