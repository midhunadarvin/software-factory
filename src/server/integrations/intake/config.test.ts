import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTAKE,
  intakeFromProject,
  parseIntake,
  pluginSettings,
  tryParseIntake,
} from "./config";

describe("intake config", () => {
  it("defaults to GitHub on, Linear/Jira off, no auto-triage", () => {
    expect(DEFAULT_INTAKE).toEqual({
      autoTriage: false,
      github: { enabled: true, label: "" },
      linear: { enabled: false, teamId: "", label: "" },
      jira: { enabled: false, projectKey: "", label: "" },
    });
    expect(parseIntake(null)).toEqual(DEFAULT_INTAKE);
    expect(parseIntake("")).toEqual(DEFAULT_INTAKE);
    expect(parseIntake(undefined)).toEqual(DEFAULT_INTAKE);
    expect(intakeFromProject(null)).toEqual(DEFAULT_INTAKE);
    expect(intakeFromProject({})).toEqual(DEFAULT_INTAKE);
    expect(intakeFromProject({ intake: null })).toEqual(DEFAULT_INTAKE);
  });

  it("fills missing provider blocks from a partial object or JSON string", () => {
    const fromObj = parseIntake({ autoTriage: true, linear: { enabled: true, teamId: "t1" } });
    expect(fromObj.autoTriage).toBe(true);
    expect(pluginSettings(fromObj, "linear")).toMatchObject({ enabled: true, teamId: "t1", label: "" });
    expect(pluginSettings(fromObj, "github").enabled).toBe(true);
    expect(pluginSettings(fromObj, "jira").enabled).toBe(false);

    const fromJson = parseIntake(
      JSON.stringify({
        autoTriage: false,
        github: { enabled: true, label: "factory" },
        jira: { enabled: true, projectKey: "ENG" },
      }),
    );
    expect(pluginSettings(fromJson, "github").label).toBe("factory");
    expect(pluginSettings(fromJson, "jira").projectKey).toBe("ENG");
    expect(pluginSettings(fromJson, "linear").enabled).toBe(false);
  });

  it("returns the default when a project stores invalid JSON", () => {
    expect(intakeFromProject({ intake: "{not json" })).toEqual(DEFAULT_INTAKE);
    const bad = tryParseIntake("{not json");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.length).toBeGreaterThan(0);
    const badType = tryParseIntake({ autoTriage: "yes" });
    expect(badType.ok).toBe(false);
  });

  it("round-trips a full config", () => {
    const raw = {
      autoTriage: true,
      github: { enabled: false, label: "factory" },
      linear: { enabled: true, teamId: "team-1", label: "ready" },
      jira: { enabled: true, projectKey: "OPS", label: "factory" },
    };
    const parsed = parseIntake(JSON.stringify(raw));
    expect(parsed).toEqual(raw);
    expect(intakeFromProject({ intake: JSON.stringify(raw) })).toEqual(raw);
    expect(tryParseIntake(raw)).toEqual({ ok: true, intake: raw });
  });
});
