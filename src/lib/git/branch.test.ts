import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGit } from "./exec";
import {
  commitProductChanges,
  currentBranch,
  ensureFeatureBranch,
  isDefaultBranch,
  isFactoryArtifactPath,
  isFeatureBranch,
  productStatus,
} from "./branch";

const roots: string[] = [];

afterEach(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  roots.length = 0;
});

async function initRepo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "factory-branch-"));
  roots.push(cwd);
  await runGit(["init"], { cwd });
  await runGit(["checkout", "-B", "main"], { cwd });
  await runGit(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"], {
    cwd,
  });
  return cwd;
}

describe("isFeatureBranch", () => {
  it("treats main/master/develop as default, factory/* as feature", () => {
    expect(isDefaultBranch("main", "main")).toBe(true);
    expect(isDefaultBranch("master", "develop")).toBe(true);
    expect(isFeatureBranch("main", "main")).toBe(false);
    expect(isFeatureBranch("factory/2-fix-bug", "main")).toBe(true);
    expect(isFeatureBranch("feat/add", "main")).toBe(true);
    expect(isFeatureBranch("random", "main")).toBe(false);
  });
});

describe("ensureFeatureBranch", () => {
  it("creates a factory branch when HEAD is the default branch", async () => {
    const cwd = await initRepo();
    expect(await currentBranch(cwd)).toBe("main");
    const r = await ensureFeatureBranch({
      cwd,
      defaultBranch: "main",
      preferred: "factory/2-fix-bug",
    });
    expect(r.created).toBe(true);
    expect(r.previous).toBe("main");
    expect(r.branch).toBe("factory/2-fix-bug");
    expect(await currentBranch(cwd)).toBe("factory/2-fix-bug");
  });

  it("leaves an existing feature branch alone", async () => {
    const cwd = await initRepo();
    await runGit(["checkout", "-b", "feat/already"], { cwd });
    const r = await ensureFeatureBranch({
      cwd,
      defaultBranch: "main",
      preferred: "factory/other",
    });
    expect(r.created).toBe(false);
    expect(r.branch).toBe("feat/already");
  });
});

describe("commitProductChanges", () => {
  it("treats .factory paths as factory notes", () => {
    expect(isFactoryArtifactPath(".factory")).toBe(true);
    expect(isFactoryArtifactPath(".factory/issues/2/requirements.md")).toBe(true);
    expect(isFactoryArtifactPath("src/app.js")).toBe(false);
  });

  it("commits product files and leaves factory notes untracked", async () => {
    const cwd = await initRepo();
    fs.mkdirSync(path.join(cwd, ".factory", "issues", "2"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src.js"), "export const n = 1;\n");
    fs.writeFileSync(path.join(cwd, ".factory", "issues", "2", "requirements.md"), "# plan\n");
    expect(await commitProductChanges(cwd, "product only")).toBe(true);
    const names = await runGit(["ls-tree", "-r", "--name-only", "HEAD"], { cwd });
    expect(names.stdout).toContain("src.js");
    expect(names.stdout).not.toContain(".factory");
    expect(await productStatus(cwd)).toBe("");
    expect(fs.existsSync(path.join(cwd, ".factory", "issues", "2", "requirements.md"))).toBe(true);
  });

  it("drops factory notes that were already committed", async () => {
    const cwd = await initRepo();
    fs.mkdirSync(path.join(cwd, ".factory", "issues", "2"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".factory", "issues", "2", "tech-spec.md"), "# spec\n");
    await runGit(["add", "-A"], { cwd });
    await runGit(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "leaked notes"], {
      cwd,
    });
    expect(await commitProductChanges(cwd, "omit notes")).toBe(true);
    const names = await runGit(["ls-tree", "-r", "--name-only", "HEAD"], { cwd });
    expect(names.stdout).not.toContain(".factory");
    expect(fs.existsSync(path.join(cwd, ".factory", "issues", "2", "tech-spec.md"))).toBe(true);
  });
});
