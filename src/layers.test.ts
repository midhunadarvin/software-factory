import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = __dirname;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function importsOf(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  return [...src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");

const RULES: { name: string; banned: RegExp; allowedIn: string }[] = [
  {
    name: "database drivers stay in server/data/drivers",
    banned: /^(drizzle-orm|better-sqlite3|@langchain\/langgraph-checkpoint-sqlite)(\/|$)/,
    allowedIn: "server/data/drivers/",
  },
  { name: "driver internals stay behind getStore()", banned: /data\/drivers\//, allowedIn: "server/data/" },
  { name: "LLM SDKs stay in server/llm", banned: /^@ai-sdk\//, allowedIn: "server/llm/" },
];

describe("module layers", () => {
  const files = sourceFiles(SRC);

  for (const rule of RULES) {
    it(rule.name, () => {
      const offenders = files
        .filter((f) => !rel(f).startsWith(rule.allowedIn))
        .flatMap((f) => importsOf(f).filter((s) => rule.banned.test(s)).map((s) => `${rel(f)} -> ${s}`));
      expect(offenders).toEqual([]);
    });
  }
});
