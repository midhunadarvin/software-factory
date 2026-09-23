import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fixtureFr } from "../fixtures";
import { artifactFilePath, coerceHarnessArtifact, readArtifactFile, writeArtifactFile } from "./artifact-file";

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
});
