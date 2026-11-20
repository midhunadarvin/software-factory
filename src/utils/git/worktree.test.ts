import { describe, expect, it } from "vitest";
import { branchName } from "./worktree";

describe("branchName", () => {
  it("builds a stable factory branch from issue number, title, and job id", () => {
    expect(branchName(12, "Add health check!", "abcdef12-9999-4000-8000-ffffffffffff")).toBe(
      "factory/12-add-health-check-abcdef12",
    );
  });

  it("uses abs(issueNumber) so local negative issues stay readable", () => {
    expect(branchName(-3, "local job", "12345678-0000-4000-8000-000000000001")).toBe("factory/3-local-job-12345678");
  });

  it("falls back to job when the title has no slug characters", () => {
    expect(branchName(1, "!!!", "zzzzzzzz-0000-4000-8000-000000000002")).toBe("factory/1-job-zzzzzzzz");
  });

  it("truncates long titles", () => {
    const name = branchName(9, "a".repeat(80), "abcd1234-0000-4000-8000-000000000003");
    expect(name.startsWith("factory/9-")).toBe(true);
    expect(name.endsWith("-abcd1234")).toBe(true);
    expect(name.length).toBeLessThan(80);
  });
});
