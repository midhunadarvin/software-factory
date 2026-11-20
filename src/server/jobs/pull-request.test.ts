import { describe, expect, it } from "vitest";
import { clipDetail, formatPublishFailure, parseGhPrOutput } from "./pull-request";

describe("parseGhPrOutput", () => {
  it("reads a gh pr create URL", () => {
    const parsed = parseGhPrOutput("https://github.com/acme/app/pull/42\n");
    expect(parsed).toEqual({ url: "https://github.com/acme/app/pull/42", number: 42 });
  });
});

describe("formatPublishFailure", () => {
  it("lists each attempt with status and output", () => {
    const message = formatPublishFailure([
      { step: "gh pr create", ok: false, code: 1, detail: "GraphQL: Resource not accessible" },
      {
        step: "POST /repos/acme/app/pulls",
        ok: false,
        status: 403,
        detail: '{"message":"Resource not accessible by personal access token","status":"403"}',
      },
    ]);
    expect(message).toContain("GitHub create PR failed.");
    expect(message).toContain("fail gh pr create exit 1: GraphQL: Resource not accessible");
    expect(message).toContain("fail POST /repos/acme/app/pulls HTTP 403");
    expect(message).toContain("Resource not accessible by personal access token");
  });

  it("clips long command output", () => {
    expect(clipDetail("x".repeat(20), 8)).toBe("xxxxxxxx…");
  });
});
