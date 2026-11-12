import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fixtureFr } from "../fixtures";
import {
  artifactFilePath,
  coerceHarnessArtifact,
  inferTriageFromText,
  parseArtifactFromText,
  readArtifactFile,
  writeArtifactFile,
} from "./artifact-file";

describe("artifact file contract", () => {
  it("round-trips FR JSON in the factory issue folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-artifact-"));
    const fr = fixtureFr("Fix add");
    writeArtifactFile(dir, -3, "fr", fr);
    expect(fs.existsSync(artifactFilePath(dir, -3, "fr"))).toBe(true);
    const raw = readArtifactFile(dir, -3, "fr");
    expect(coerceHarnessArtifact("fr", raw)).toMatchObject({ summary: fr.summary });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when the file is missing", () => {
    expect(readArtifactFile("/tmp/does-not-exist-factory", 1, "fr")).toBeNull();
  });

  it("reads a JSON file from any issues subfolder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-artifact-"));
    const fr = fixtureFr("Fix add");
    writeArtifactFile(dir, 99, "fr", fr);
    expect(readArtifactFile(dir, 1, "fr")).toMatchObject({ summary: fr.summary });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("parses JSON from CLI stdout", () => {
    expect(parseArtifactFromText('{"ok":true}')).toEqual({ ok: true });
    expect(parseArtifactFromText('done\n```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it("infers a triage report from Claude prose when the JSON file is missing", () => {
    const inferred = inferTriageFromText(
      "I couldn't write the triage file. My provisional call is **simple**, **medium risk**, `fastTrack` false.",
    );
    expect(inferred).toMatchObject({
      version: 1,
      classification: "simple",
      risk: "medium",
      fastTrack: false,
    });
  });
});
