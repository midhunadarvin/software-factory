import { describe, expect, it } from "vitest";
import { decodeSecret, resetEnvCache } from "../env";
import { deriveKeys } from "./hkdf";

describe("FACTORY_SECRET", () => {
  it("accepts 64 hex chars", () => {
    const hex = "ab".repeat(32);
    expect(decodeSecret(hex, "FACTORY_SECRET").length).toBe(32);
  });

  it("rejects raw utf-8", () => {
    expect(() => decodeSecret("not-a-valid-secret-value-at-all!!", "FACTORY_SECRET")).toThrow();
  });

  it("splits hkdf keys", () => {
    process.env.FACTORY_SECRET = "ab".repeat(32);
    process.env.FACTORY_APP_PASSWORD = "x";
    resetEnvCache();
    const k = deriveKeys();
    expect(k.aesPat.length).toBe(32);
    expect(k.hmacSession.length).toBe(32);
    expect(k.aesPat.equals(k.hmacSession)).toBe(false);
  });
});
