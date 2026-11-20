import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_HARNESS_CONFIG, defaultHarnessConfig, harnessForLane, parseHarnessConfig } from "./config";
import { clearHarnessDetectCache } from "./detect";

describe("parseHarnessConfig", () => {
  afterEach(() => clearHarnessDetectCache());

  it("defaults to inprocess when no CLI is cached", () => {
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
    expect(parseHarnessConfig({ default: "tmux" })).toEqual(defaultHarnessConfig());
  });
});
