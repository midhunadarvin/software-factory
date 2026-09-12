import { afterEach, describe, expect, it } from "vitest";
import { parseIntake } from "../intake/config";
import { matchProject } from "./match";
import {
  getIntegration,
  listIntegrations,
  loadBuiltinIntegrations,
  publicIntegrations,
  registerIntegration,
  unregisterIntegration,
} from "./registry";
import type { IncomingIssue, IntegrationPlugin } from "./types";

const stub: IntegrationPlugin = {
  id: "stub",
  label: "Stub",
  description: "Test plugin",
  secretEnv: "STUB_WEBHOOK_SECRET",
  defaultEnabled: true,
  fallbackToSingle: true,
  settingsFields: [{ key: "space", label: "Space", kind: "text" }],
  webhookUrl: (origin) => `${origin}/api/webhooks/stub`,
  verify: () => ({ ok: true }),
  parse: () => ({ kind: "ignore", reason: "n/a" }),
  match: (issue, _project, settings) => String(settings.space ?? "") === (issue.attrs.space ?? ""),
};

afterEach(() => {
  unregisterIntegration("stub");
  loadBuiltinIntegrations();
});

describe("integration registry", () => {
  it("loads GitHub, Linear, and Jira by default", () => {
    const ids = listIntegrations().map((p) => p.id);
    expect(ids).toEqual(["github", "linear", "jira"]);
    expect(getIntegration("github")?.label).toBe("GitHub");
    expect(publicIntegrations().map((p) => p.webhookPath)).toEqual(["github", "linear", "jira"]);
  });

  it("registers a third-party plugin and includes it in intake defaults", () => {
    registerIntegration(stub);
    expect(getIntegration("stub")?.label).toBe("Stub");
    const intake = parseIntake({});
    expect((intake.stub as { enabled: boolean }).enabled).toBe(true);
    const issue: IncomingIssue = {
      source: "stub",
      externalKey: "stub:1",
      issueNumber: 1,
      title: "x",
      body: "",
      url: "",
      labels: [],
      attrs: { space: "ops" },
    };
    const hit = matchProject(issue, [
      { id: "p1", repoOwner: null, repoName: null, intake: JSON.stringify({ stub: { enabled: true, space: "ops" } }) },
    ]);
    expect(hit?.project.id).toBe("p1");
  });

  it("rejects an invalid plugin id", () => {
    expect(() => registerIntegration({ ...stub, id: "Nope" })).toThrow(/invalid integration id/);
  });
});
