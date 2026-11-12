import { afterEach, describe, expect, it, vi } from "vitest";
import { whichBinary } from "./which";
import {
  clearHarnessDetectCache,
  defaultHarnessId,
  detectCliHarnesses,
  preferredCliHarness,
  setHarnessDetectCache,
} from "./detect";
import { defaultHarnessConfig, parseHarnessConfig } from "./config";

vi.mock("./which", () => ({
  whichBinary: vi.fn(async () => null),
}));

const which = vi.mocked(whichBinary);

describe("detectCliHarnesses", () => {
  afterEach(() => {
    clearHarnessDetectCache();
    which.mockReset();
    which.mockResolvedValue(null);
  });

  it("prefers claude, then cursor-agent, then codex", async () => {
    which.mockImplementation(async (name) => {
      if (name === "claude") return "/usr/bin/claude";
      if (name === "cursor-agent") return "/usr/bin/cursor-agent";
      if (name === "codex") return "/usr/bin/codex";
      return null;
    });
    await expect(detectCliHarnesses(true)).resolves.toEqual(["claude", "cursor", "codex"]);
    expect(preferredCliHarness()).toBe("claude");
    expect(defaultHarnessId()).toBe("claude");
  });

  it("falls back to cursor when claude is missing", async () => {
    which.mockImplementation(async (name) => (name === "cursor-agent" ? "/usr/bin/cursor-agent" : null));
    await expect(detectCliHarnesses(true)).resolves.toEqual(["cursor"]);
    expect(defaultHarnessConfig()).toEqual({ default: "cursor", byLane: {} });
  });

  it("falls back to inprocess when no CLI is on PATH", async () => {
    await expect(detectCliHarnesses(true)).resolves.toEqual([]);
    expect(defaultHarnessId()).toBe("inprocess");
    expect(parseHarnessConfig(null)).toEqual({ default: "inprocess", byLane: {} });
  });

  it("uses a primed CLI as the stored-config default", () => {
    setHarnessDetectCache(["cursor"]);
    expect(parseHarnessConfig(null)).toEqual({ default: "cursor", byLane: {} });
  });
});
