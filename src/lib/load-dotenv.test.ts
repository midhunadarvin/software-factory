import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadDotenv } from "./load-dotenv";

describe("loadDotenv", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
    delete process.env.FACTORY_ROOT;
    delete process.env.DOTENV_TEST_KEY;
    delete process.env.DOTENV_TEST_EXISTING;
  });

  it("loads KEY=value and skips comments, without overriding existing env", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-env-"));
    dirs.push(dir);
    fs.writeFileSync(
      path.join(dir, ".env"),
      ["# comment", "DOTENV_TEST_KEY=from-file", "DOTENV_TEST_EXISTING=file-value", "NOTHING", "=novalue", ""].join("\n"),
    );
    process.env.FACTORY_ROOT = dir;
    process.env.DOTENV_TEST_EXISTING = "already";
    loadDotenv();
    expect(process.env.DOTENV_TEST_KEY).toBe("from-file");
    expect(process.env.DOTENV_TEST_EXISTING).toBe("already");
  });

  it("is a no-op when .env is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-env-"));
    dirs.push(dir);
    process.env.FACTORY_ROOT = dir;
    expect(() => loadDotenv()).not.toThrow();
  });
});
