import { describe, expect, it } from "vitest";
import { getHarness, listHarnesses, registerHarness } from "./registry";

describe("harness registry", () => {
  it("loads inprocess plus CLI adapters", () => {
    expect(listHarnesses().map((h) => h.id).sort()).toEqual(["claude", "codex", "cursor", "inprocess"]);
    expect(getHarness("inprocess")?.label).toMatch(/in-process/i);
  });

  it("rejects an unknown harness id", () => {
    expect(() =>
      registerHarness({
        id: "tmux" as "inprocess",
        label: "nope",
        description: "",
        detect: async () => ({ ok: true }),
        start: async () => {
          throw new Error("no");
        },
      }),
    ).toThrow(/invalid harness id/);
  });
});
