import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  jiraDescriptionToText,
  labelsInclude,
  parseGithubIssueEvent,
  parseJiraIssueEvent,
  parseLinearIssueEvent,
} from "./parse";
import { matchProject } from "./match";
import { verifyGithubSignature, verifyLinearSignature, verifySharedSecret, webhookSecrets } from "./verify";

const githubIssue = {
  action: "opened",
  issue: {
    number: 12,
    title: "Add healthcheck",
    body: "Expose GET /health",
    html_url: "https://github.com/acme/api/issues/12",
    labels: [{ name: "factory" }],
  },
  repository: { owner: { login: "acme" }, name: "api" },
};

describe("webhook signatures", () => {
  const body = Buffer.from(JSON.stringify({ ok: true }));
  const secret = "s3cret";

  it("accepts a valid GitHub HMAC", () => {
    const hex = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyGithubSignature(secret, body, `sha256=${hex}`)).toBe(true);
    expect(verifyGithubSignature(secret, body, `sha256=deadbeef`)).toBe(false);
    expect(verifyGithubSignature("", body, `sha256=${hex}`)).toBe(false);
  });

  it("accepts a valid Linear HMAC", () => {
    const hex = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyLinearSignature(secret, body, hex)).toBe(true);
    expect(verifyLinearSignature(secret, body, "nope")).toBe(false);
  });

  it("compares Jira shared secrets in constant time", () => {
    expect(verifySharedSecret(secret, secret)).toBe(true);
    expect(verifySharedSecret(secret, "other")).toBe(false);
    expect(verifySharedSecret(secret, null)).toBe(false);
  });
});

describe("parse incoming issues", () => {
  it("maps a GitHub issues.opened payload", () => {
    const issue = parseGithubIssueEvent(githubIssue, "issues");
    expect(issue?.externalKey).toBe("github:acme/api#12");
    expect(issue?.issueNumber).toBe(12);
    expect(issue?.repoOwner).toBe("acme");
    expect(parseGithubIssueEvent(githubIssue, "ping")).toBeNull();
    expect(parseGithubIssueEvent({ ...githubIssue, action: "closed" }, "issues")).toBeNull();
  });

  it("maps a Linear Issue create payload", () => {
    const issue = parseLinearIssueEvent({
      type: "Issue",
      action: "create",
      data: {
        id: "iss-1",
        identifier: "ENG-9",
        number: 9,
        title: "Fix login",
        description: "Broken cookie",
        url: "https://linear.app/acme/issue/ENG-9",
        teamId: "team-1",
        labels: [{ name: "factory" }],
      },
    });
    expect(issue?.externalKey).toBe("linear:iss-1");
    expect(issue?.linearTeamId).toBe("team-1");
    expect(issue?.body).toContain("ENG-9");
  });

  it("flattens Jira ADF and builds a browse URL", () => {
    const text = jiraDescriptionToText({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Ship it" }] },
      ],
    });
    expect(text).toContain("Ship it");
    const issue = parseJiraIssueEvent({
      webhookEvent: "jira:issue_created",
      issue: {
        key: "ENG-4",
        self: "https://acme.atlassian.net/rest/api/2/issue/1004",
        fields: { summary: "Pager", description: "On-call", project: { key: "ENG" }, labels: [] },
      },
    });
    expect(issue?.externalKey).toBe("jira:ENG-4");
    expect(issue?.url).toBe("https://acme.atlassian.net/browse/ENG-4");
    expect(issue?.jiraProjectKey).toBe("ENG");
  });
});

describe("project matching", () => {
  const githubProject = {
    id: "p1",
    repoOwner: "acme",
    repoName: "api",
    intake: JSON.stringify({
      autoTriage: true,
      github: { enabled: true, label: "" },
      linear: { enabled: false, teamId: "", label: "" },
      jira: { enabled: false, projectKey: "", label: "" },
    }),
  };

  it("routes a GitHub issue to the matching repo", () => {
    const issue = parseGithubIssueEvent(githubIssue, "issues")!;
    const hit = matchProject(issue, [githubProject]);
    expect(hit?.project.id).toBe("p1");
    expect(hit?.intake.autoTriage).toBe(true);
  });

  it("honors a required GitHub label", () => {
    const labeled = {
      ...githubProject,
      intake: JSON.stringify({
        github: { enabled: true, label: "factory" },
        linear: { enabled: false },
        jira: { enabled: false },
      }),
    };
    const issue = parseGithubIssueEvent(
      { ...githubIssue, issue: { ...githubIssue.issue, labels: [] } },
      "issues",
    )!;
    expect(matchProject(issue, [labeled])).toBeNull();
    expect(labelsInclude(["factory"], "factory")).toBe(true);
  });

  it("routes Linear by team id when several projects are enabled", () => {
    const a = {
      id: "a",
      repoOwner: null,
      repoName: null,
      intake: JSON.stringify({ linear: { enabled: true, teamId: "team-a" } }),
    };
    const b = {
      id: "b",
      repoOwner: null,
      repoName: null,
      intake: JSON.stringify({ linear: { enabled: true, teamId: "team-b" } }),
    };
    const issue = parseLinearIssueEvent({
      type: "Issue",
      action: "create",
      data: { id: "1", title: "x", teamId: "team-b" },
    })!;
    expect(matchProject(issue, [a, b])?.project.id).toBe("b");
  });

  it("uses the only Linear-enabled project when team id is unset", () => {
    const only = {
      id: "solo",
      repoOwner: null,
      repoName: null,
      intake: JSON.stringify({ linear: { enabled: true, teamId: "" } }),
    };
    const issue = parseLinearIssueEvent({
      type: "Issue",
      action: "create",
      data: { id: "1", title: "x", teamId: "anything" },
    })!;
    expect(matchProject(issue, [only])?.project.id).toBe("solo");
    expect(matchProject(issue, [only, { ...only, id: "two" }])).toBeNull();
  });

  it("routes Jira by project key and required label", () => {
    const eng = {
      id: "eng",
      repoOwner: null,
      repoName: null,
      intake: JSON.stringify({ jira: { enabled: true, projectKey: "ENG", label: "factory" } }),
    };
    const ops = {
      id: "ops",
      repoOwner: null,
      repoName: null,
      intake: JSON.stringify({ jira: { enabled: true, projectKey: "OPS", label: "" } }),
    };
    const created = parseJiraIssueEvent({
      webhookEvent: "jira:issue_created",
      issue: {
        key: "ENG-4",
        fields: { summary: "Pager", project: { key: "ENG" }, labels: ["factory"] },
      },
    })!;
    expect(matchProject(created, [eng, ops])?.project.id).toBe("eng");
    const unlabeled = parseJiraIssueEvent({
      webhookEvent: "jira:issue_created",
      issue: { key: "ENG-5", fields: { summary: "x", project: { key: "ENG" }, labels: [] } },
    })!;
    expect(matchProject(unlabeled, [eng, ops])).toBeNull();
    const opsIssue = parseJiraIssueEvent({
      webhookEvent: "jira:issue_updated",
      issue: { key: "OPS-1", fields: { summary: "disk", project: { key: "OPS" }, labels: [] } },
    })!;
    expect(matchProject(opsIssue, [eng, ops])?.project.id).toBe("ops");
  });

  it("ignores GitHub when the project disabled GitHub intake", () => {
    const off = {
      id: "p1",
      repoOwner: "acme",
      repoName: "api",
      intake: JSON.stringify({ github: { enabled: false, label: "" } }),
    };
    const issue = parseGithubIssueEvent(githubIssue, "issues")!;
    expect(matchProject(issue, [off])).toBeNull();
  });

  it("matches GitHub owner/repo case-insensitively", () => {
    const project = {
      id: "p1",
      repoOwner: "Acme",
      repoName: "API",
      intake: JSON.stringify({ github: { enabled: true, label: "" } }),
    };
    const issue = parseGithubIssueEvent(githubIssue, "issues")!;
    expect(matchProject(issue, [project])?.project.id).toBe("p1");
  });

  it("does not match a different GitHub repo", () => {
    const project = {
      id: "p1",
      repoOwner: "acme",
      repoName: "other",
      intake: JSON.stringify({ github: { enabled: true, label: "" } }),
    };
    expect(matchProject(parseGithubIssueEvent(githubIssue, "issues")!, [project])).toBeNull();
  });
});

describe("parse edge cases", () => {
  it("ingests GitHub reopened and labeled, skips PRs and closed", () => {
    const base = { ...githubIssue, action: "reopened" };
    expect(parseGithubIssueEvent(base, "issues")?.issueNumber).toBe(12);
    expect(parseGithubIssueEvent({ ...githubIssue, action: "labeled" }, "issues")?.externalKey).toContain("#12");
    expect(
      parseGithubIssueEvent(
        { ...githubIssue, issue: { ...githubIssue.issue, pull_request: {} } },
        "issues",
      ),
    ).toBeNull();
    expect(parseGithubIssueEvent({ action: "opened" }, "issues")).toBeNull();
    expect(parseGithubIssueEvent(githubIssue, "pull_request")).toBeNull();
    expect(parseGithubIssueEvent({ ...githubIssue, issue: { ...githubIssue.issue, title: "  " } }, "issues")?.title).toBe(
      "Issue #12",
    );
  });

  it("ignores Linear comments and deletes, accepts update", () => {
    expect(parseLinearIssueEvent({ type: "Comment", action: "create", data: { id: "c", title: "x" } })).toBeNull();
    expect(parseLinearIssueEvent({ type: "Issue", action: "remove", data: { id: "1", title: "x" } })).toBeNull();
    expect(
      parseLinearIssueEvent({ type: "Issue", action: "update", data: { id: "1", title: " renamed " } })?.title,
    ).toBe("renamed");
    expect(parseLinearIssueEvent({ data: { id: "1" } })).toBeNull();
    expect(parseLinearIssueEvent({ data: { title: "no id" } })).toBeNull();
  });

  it("ignores Jira comment events and missing keys", () => {
    expect(parseJiraIssueEvent({ webhookEvent: "comment_created", issue: { key: "ENG-1" } })).toBeNull();
    expect(parseJiraIssueEvent({ webhookEvent: "jira:issue_created", issue: {} })).toBeNull();
    expect(
      parseJiraIssueEvent({
        webhookEvent: "jira:issue_created",
        issue: { key: "NOKEY", fields: { summary: "x" } },
      })?.issueNumber,
    ).toBeNull();
    expect(jiraDescriptionToText(null)).toBe("");
    expect(jiraDescriptionToText("plain")).toBe("plain");
    expect(jiraDescriptionToText(12)).toBe("");
  });

  it("treats blank required labels as match-all", () => {
    expect(labelsInclude([], "")).toBe(true);
    expect(labelsInclude([], "  ")).toBe(true);
    expect(labelsInclude(["Factory"], "factory")).toBe(true);
    expect(labelsInclude(["bug"], "factory")).toBe(false);
  });
});

describe("webhookSecrets", () => {
  it("reads provider secrets from env", () => {
    const prev = {
      g: process.env.GITHUB_WEBHOOK_SECRET,
      l: process.env.LINEAR_WEBHOOK_SECRET,
      j: process.env.JIRA_WEBHOOK_SECRET,
    };
    process.env.GITHUB_WEBHOOK_SECRET = "gh";
    process.env.LINEAR_WEBHOOK_SECRET = "lin";
    process.env.JIRA_WEBHOOK_SECRET = "jira";
    expect(webhookSecrets()).toEqual({ github: "gh", linear: "lin", jira: "jira" });
    delete process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.LINEAR_WEBHOOK_SECRET;
    delete process.env.JIRA_WEBHOOK_SECRET;
    expect(webhookSecrets()).toEqual({ github: "", linear: "", jira: "" });
    if (prev.g) process.env.GITHUB_WEBHOOK_SECRET = prev.g;
    if (prev.l) process.env.LINEAR_WEBHOOK_SECRET = prev.l;
    if (prev.j) process.env.JIRA_WEBHOOK_SECRET = prev.j;
  });

  it("rejects missing GitHub/Linear headers", () => {
    const body = Buffer.from("{}");
    expect(verifyGithubSignature("s", body, null)).toBe(false);
    expect(verifyLinearSignature("s", body, null)).toBe(false);
    expect(verifyGithubSignature("s", body, "sha256=" + "a".repeat(64))).toBe(false);
  });
});
