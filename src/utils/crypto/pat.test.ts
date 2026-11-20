import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "../env";
import { decryptPat, encryptPat } from "./pat";

describe("encryptPat / decryptPat", () => {
  afterEach(() => {
    resetEnvCache();
  });

  it("round-trips a PAT for a project id", () => {
    process.env.FACTORY_SECRET = "ab".repeat(32);
    process.env.FACTORY_APP_PASSWORD = "pw";
    resetEnvCache();
    const enc = encryptPat("proj-1", "ghp_secretPAT");
    expect(enc.ciphertext.length).toBeGreaterThan(0);
    expect(enc.iv.length).toBe(12);
    expect(enc.tag.length).toBe(16);
    expect(decryptPat("proj-1", enc)).toBe("ghp_secretPAT");
  });

  it("fails when the project id (AAD) does not match", () => {
    process.env.FACTORY_SECRET = "ab".repeat(32);
    process.env.FACTORY_APP_PASSWORD = "pw";
    resetEnvCache();
    const enc = encryptPat("proj-1", "ghp_secretPAT");
    expect(() => decryptPat("proj-2", enc)).toThrow(/failed to decrypt PAT/);
  });
});
