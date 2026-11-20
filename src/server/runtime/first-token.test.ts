import { afterEach, describe, expect, it, vi } from "vitest";
import {
  firstTokenTimeoutMessage,
  idleTimeoutMessage,
  startFirstTokenWatch,
  startStreamWatch,
} from "./first-token";

describe("startFirstTokenWatch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out when no tokens arrive", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    startFirstTokenWatch({ ms: 30_000, onTimeout });
    vi.advanceTimersByTime(29_999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("does not time out after a token", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watch = startFirstTokenWatch({ ms: 30_000, onTimeout });
    watch.noteToken();
    vi.advanceTimersByTime(60_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("formats the operator message", () => {
    expect(firstTokenTimeoutMessage(30_000)).toBe("No tokens from the model within 30s");
    expect(idleTimeoutMessage(180_000)).toBe("No output from the coding CLI for 180s");
  });

  it("times out when the CLI goes silent after tokens", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watch = startStreamWatch({ firstMs: 30_000, idleMs: 5_000, onTimeout });
    watch.noteToken();
    vi.advanceTimersByTime(4_999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledWith("idle");
  });
});
