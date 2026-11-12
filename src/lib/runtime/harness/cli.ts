import { spawn, type ChildProcess } from "node:child_process";
import {
  CLI_IDLE_TIMEOUT_MS,
  FIRST_TOKEN_TIMEOUT_MS,
  firstTokenTimeoutMessage,
  idleTimeoutMessage,
  startStreamWatch,
} from "../first-token";
import { cliSpawnEnv } from "./model-flag";
import { pushStream } from "../stream";
import type { HarnessResult, HarnessSession, LaneRunRequest } from "./types";
import { parseStreamJsonLine, splitLines, type StreamJsonAcc } from "./stream-json";

export type CliHarnessOpts = {
  binary: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  req: LaneRunRequest;
  promptArg?: boolean;
  firstTokenMs?: number;
  idleMs?: number;
};

export function captureCli(
  binary: string,
  args: string[],
  opts?: { timeoutMs?: number; cwd?: string },
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: opts?.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, opts?.timeoutMs ?? 15_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

export function parseDashModelList(text: string): {
  models: { id: string; name?: string }[];
  defaultModel?: string;
} {
  const models: { id: string; name?: string }[] = [];
  let defaultModel: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^available models$/i.test(line)) continue;
    const m = line.match(/^(\S+)\s+-\s+(.+)$/);
    if (!m) continue;
    const id = m[1];
    let name = m[2].trim();
    if (/\(default\)\s*$/i.test(name)) {
      name = name.replace(/\s*\(default\)\s*$/i, "").trim();
      defaultModel ??= id;
    }
    if (!models.some((row) => row.id === id)) models.push({ id, name: name || undefined });
  }
  return { models, defaultModel };
}

export function startCliSession(opts: CliHarnessOpts): HarnessSession {
  const cwd = opts.req.cwd;
  if (!cwd) throw new Error("CLI harness needs a worktree");
  const args = opts.promptArg ? [...opts.args, opts.req.brief] : opts.args;
  const child: ChildProcess = spawn(opts.binary, args, {
    cwd,
    env: cliSpawnEnv(opts.env),
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (!opts.promptArg) {
    child.stdin?.write(opts.req.brief);
    child.stdin?.write("\n");
    child.stdin?.end();
  } else {
    child.stdin?.end();
  }

  let buf = "";
  let text = "";
  let sessionId = opts.req.resumeSessionId;
  let timedOut: "first" | "idle" | false = false;
  const timeoutMs = opts.firstTokenMs ?? FIRST_TOKEN_TIMEOUT_MS;
  const idleMs = opts.idleMs ?? CLI_IDLE_TIMEOUT_MS;
  const watch = startStreamWatch({
    firstMs: timeoutMs,
    idleMs,
    onTimeout: (kind) => {
      if (child.exitCode != null) return;
      timedOut = kind;
      const msg = kind === "idle" ? idleTimeoutMessage(idleMs) : firstTokenTimeoutMessage(timeoutMs);
      pushStream({
        jobId: opts.req.jobId,
        projectId: opts.req.projectId,
        lane: opts.req.laneId,
        kind: "thinking",
        delta: `${msg}\n`,
      });
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode == null) child.kill("SIGKILL");
      }, 4000);
    },
  });
  const streamAcc: StreamJsonAcc = {};
  const emit = (line: string) => {
    const parsed = parseStreamJsonLine(line, streamAcc);
    if (parsed.sessionId) sessionId = parsed.sessionId;
    for (const part of parsed.parts) {
      watch.noteToken();
      if (part.type === "text") text += part.delta;
      pushStream({
        jobId: opts.req.jobId,
        projectId: opts.req.projectId,
        lane: opts.req.laneId,
        kind: part.type,
        delta: part.delta,
        tool: part.tool,
      });
    }
    if (!parsed.parts.length && line.trim() && !line.trim().startsWith("{")) {
      watch.noteToken();
      text += line;
      pushStream({
        jobId: opts.req.jobId,
        projectId: opts.req.projectId,
        lane: opts.req.laneId,
        kind: "text",
        delta: line + "\n",
      });
    }
  };

  child.stdout?.on("data", (chunk) => {
    buf += String(chunk);
    const split = splitLines(buf);
    buf = split.rest;
    for (const line of split.lines) emit(line);
  });
  child.stderr?.on("data", (chunk) => {
    const line = String(chunk);
    pushStream({
      jobId: opts.req.jobId,
      projectId: opts.req.projectId,
      lane: opts.req.laneId,
      kind: "thinking",
      delta: line,
    });
  });

  const result = new Promise<HarnessResult>((resolve, reject) => {
    child.on("error", (err) => {
      watch.clear();
      reject(err);
    });
    child.on("close", (code) => {
      watch.clear();
      if (buf.trim()) emit(buf);
      const timeoutText =
        timedOut === "idle" ? idleTimeoutMessage(idleMs) : firstTokenTimeoutMessage(timeoutMs);
      resolve({
        text: timedOut ? timeoutText : text.trim(),
        code: timedOut ? 1 : (code ?? 1),
        sessionId,
      });
    });
  });

  return {
    id: sessionId ?? `${opts.binary}-${opts.req.jobId}`,
    pid: child.pid,
    send: async (message) => {
      if (!child.stdin || child.killed) throw new Error("harness is not accepting input");
      child.stdin.write(`${message}\n`);
    },
    stop: async () => {
      if (child.exitCode != null) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 4000);
        child.once("close", () => {
          clearTimeout(t);
          resolve();
        });
      });
    },
    result,
  };
}
