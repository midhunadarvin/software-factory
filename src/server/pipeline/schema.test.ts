import { describe, expect, it } from "vitest";
import { inferKind } from "./schema";

describe("inferKind", () => {
  it("uses an explicit kind when set", () => {
    expect(inferKind({ id: "review", kind: "agent", actions: [] })).toBe("agent");
    expect(inferKind({ id: "custom", kind: "terminal", actions: [{ type: "produce", artifact: "review" }] })).toBe(
      "terminal",
    );
  });

  it("infers intake / done / agent from id and actions", () => {
    expect(inferKind({ id: "intake", actions: [] })).toBe("intake");
    expect(inferKind({ id: "inbox", actions: [] })).toBe("intake");
    expect(inferKind({ id: "done", actions: [] })).toBe("terminal");
    expect(inferKind({ id: "review", actions: [{ type: "fix" }] })).toBe("agent");
    expect(inferKind({ id: "parked", actions: [] })).toBe("terminal");
  });
});
