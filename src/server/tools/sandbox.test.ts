import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertExecAllowed, longTimeout, resolveInRoot } from "./sandbox";

describe("sandbox", () => {
  const root = path.join(os.tmpdir(), "factory-wt");

  it("rejects traversal", () => {
    expect(() => resolveInRoot(root, "../etc/passwd")).toThrow();
    expect(() => resolveInRoot(root, "/etc/passwd")).toThrow();
  });

  it("allows relative files", () => {
    expect(resolveInRoot(root, "src/a.ts")).toBe(path.resolve(root, "src/a.ts"));
  });

  it("blocks npx", () => {
    expect(() => assertExecAllowed("npx")).toThrow();
    expect(() => assertExecAllowed("node")).not.toThrow();
  });

  it("allowlists git/node/pnpm and rejects curl", () => {
    for (const bin of ["git", "pnpm", "npm", "python3", "pytest", "tsc"]) {
      expect(() => assertExecAllowed(bin)).not.toThrow();
    }
    expect(() => assertExecAllowed("/usr/bin/curl")).toThrow(/not allowlisted/);
    expect(longTimeout(["pnpm", "install"])).toBe(true);
    expect(longTimeout(["npm", "test"])).toBe(true);
    expect(longTimeout(["git", "status"])).toBe(false);
  });
});
