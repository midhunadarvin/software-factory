import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertExecAllowed, resolveInRoot } from "./sandbox";

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
});
