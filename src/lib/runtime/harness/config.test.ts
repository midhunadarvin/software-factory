import { describe, expect, it } from "vitest";
import { DEFAULT_HARNESS_CONFIG, harnessForLane, parseHarnessConfig } from "./config";

describe("parseHarnessConfig", () => {
  it("defaults to inprocess", () => {
    expect(parseHarnessConfig(null)).toEqual(DEFAULT_HARNESS_CONFIG);
    expect(parseHarnessConfig("")).toEqual(DEFAULT_HARNESS_CONFIG);
    expect(parseHarnessConfig("inprocess")).toEqual({ default: "inprocess", byLane: {} });
  });

  it("accepts a default plus per-lane overrides", () => {
    const cfg = parseHarnessConfig({ default: "claude", byLane: { implementation: "codex" } });
    expect(harnessForLane(cfg, "requirements")).toBe("claude");
    expect(harnessForLane(cfg, "implementation")).toBe("codex");
  });

  it("rejects unknown ids", () => {
    expect(parseHarnessConfig({ default: "tmux" })).toEqual(DEFAULT_HARNESS_CONFIG);
  });
});
