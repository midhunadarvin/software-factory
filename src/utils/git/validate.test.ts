import { describe, expect, it } from "vitest";
import { parseGithubRemote, validateGitPath } from "./validate";

describe("parseGithubRemote", () => {
  it("parses https, ssh, and .git suffixes", () => {
    expect(parseGithubRemote("https://github.com/acme/api.git")).toEqual({ owner: "acme", repo: "api" });
    expect(parseGithubRemote("https://github.com/acme/api")).toEqual({ owner: "acme", repo: "api" });
    expect(parseGithubRemote("git@github.com:acme/api.git")).toEqual({ owner: "acme", repo: "api" });
    expect(parseGithubRemote("  git@github.com:Acme/API  ")).toEqual({ owner: "Acme", repo: "API" });
  });

  it("rejects non-GitHub remotes", () => {
    expect(parseGithubRemote("https://gitlab.com/acme/api.git")).toBeNull();
    expect(parseGithubRemote("https://example.com/acme/api")).toBeNull();
    expect(parseGithubRemote("not-a-url")).toBeNull();
  });
});

describe("validateGitPath", () => {
  it("rejects a missing path", async () => {
    const r = await validateGitPath("/tmp/software-factory-does-not-exist-xyz");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not a directory/);
  });
});
