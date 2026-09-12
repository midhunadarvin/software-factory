import { afterEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { defaultCloneDest, isInsideVar, nowIso, reposDir, varDir } from "./paths";

describe("paths", () => {
  const prevRepos = process.env.FACTORY_REPOS_DIR;

  afterEach(() => {
    if (prevRepos === undefined) delete process.env.FACTORY_REPOS_DIR;
    else process.env.FACTORY_REPOS_DIR = prevRepos;
  });

  it("defaults clone dest under ~/software-factory/repos", () => {
    delete process.env.FACTORY_REPOS_DIR;
    expect(defaultCloneDest("acme", "api")).toBe(
      path.join(os.homedir(), "software-factory", "repos", "acme", "api"),
    );
    expect(reposDir()).toBe(path.join(os.homedir(), "software-factory", "repos"));
  });

  it("honors FACTORY_REPOS_DIR for Docker / self-host", () => {
    process.env.FACTORY_REPOS_DIR = "/repos";
    expect(defaultCloneDest("acme", "api")).toBe(path.join("/repos", "acme", "api"));
  });

  it("detects paths inside var/", () => {
    const root = varDir();
    expect(isInsideVar(root)).toBe(true);
    expect(isInsideVar(path.join(root, "worktrees", "p", "j"))).toBe(true);
    expect(isInsideVar(path.join(root, "..", "src"))).toBe(false);
  });

  it("emits an ISO timestamp", () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
