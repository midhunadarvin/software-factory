import { afterEach, describe, expect, it } from "vitest";
import { isLocked, recordFailure, recordSuccess, resetLockouts } from "./lockout";

describe("lockout", () => {
  afterEach(() => resetLockouts());

  it("locks after 5 failures", () => {
    for (let i = 0; i < 5; i++) recordFailure("1.1.1.1");
    expect(isLocked("1.1.1.1")).toBe(true);
    expect(isLocked("2.2.2.2")).toBe(false);
  });

  it("clears on success", () => {
    for (let i = 0; i < 4; i++) recordFailure("1.1.1.1");
    recordSuccess("1.1.1.1");
    expect(isLocked("1.1.1.1")).toBe(false);
  });
});
