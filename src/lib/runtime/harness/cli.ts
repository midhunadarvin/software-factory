import { spawn, type ChildProcess } from "node:child_process";
import { pushStream } from "../stream";
import type { HarnessResult, HarnessSession, LaneRunRequest } from "./types";
import { parseStreamJsonLine, splitLines } from "./stream-json";

export type CliHarnessOpts = {
  binary: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  req: LaneRunRequest;
  promptArg?: boolean;
};

export function startCliSession(opts: CliHarnessOpts): HarnessSession {
  const cwd = opts.req.cwd;
  if (!cwd) throw new Error("CLI harness needs a worktree");
  const args = opts.promptArg ? [...opts.args, opts.req.brief] : opts.args;
  const child: ChildProcess = spawn(opts.binary, args, {
    cwd,
    env: { ...process.env, ...opts.env },
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
  const emit = (line: string) => {
    const parsed = parseStreamJsonLine(line);
    if (parsed.sessionId) sessionId = parsed.sessionId;
    for (const part of parsed.parts) {
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
    child.on("error", reject);
    child.on("close", (code) => {
      if (buf.trim()) emit(buf);
      resolve({ text: text.trim(), code: code ?? 1, sessionId });
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
