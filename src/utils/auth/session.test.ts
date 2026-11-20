import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "../env";
import {
  SESSION_COOKIE,
  clearCookieHeader,
  cookieHeader,
  issueSession,
  passwordsMatch,
  verifySession,
} from "./session";

describe("session cookies", () => {
  afterEach(() => {
    resetEnvCache();
  });

  function env() {
    process.env.FACTORY_SECRET = "cd".repeat(32);
    process.env.FACTORY_APP_PASSWORD = "correct-horse";
    resetEnvCache();
  }

  it("issues a token that verifies and expires in the cookie header", () => {
    env();
    const token = issueSession();
    expect(verifySession(token)).toBe(true);
    expect(verifySession(undefined)).toBe(false);
    expect(verifySession("not.a.token")).toBe(false);
    expect(verifySession("1.2.deadbeef")).toBe(false);
    const header = cookieHeader(token, true);
    expect(header).toContain(`${SESSION_COOKIE}=${token}`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(cookieHeader(token, false)).not.toContain("Secure");
    expect(clearCookieHeader()).toContain("Max-Age=0");
  });

  it("rejects a token after the password changes", () => {
    env();
    const token = issueSession();
    process.env.FACTORY_APP_PASSWORD = "new-password";
    resetEnvCache();
    expect(verifySession(token)).toBe(false);
  });

  it("compares passwords in constant time", () => {
    expect(passwordsMatch("abc", "abc")).toBe(true);
    expect(passwordsMatch("abc", "abd")).toBe(false);
    expect(passwordsMatch("ab", "abc")).toBe(false);
  });
});
