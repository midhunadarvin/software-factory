import { spawn } from "node:child_process";

export function runGit(
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`git ${args.join(" ")} timed out`));
    }, opts.timeoutMs ?? 120_000);
    opts.signal?.addEventListener("abort", () => child.kill("SIGTERM"));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function gitOk(): Promise<boolean> {
  try {
    const r = await runGit(["--version"]);
    return r.code === 0;
  } catch {
    return false;
  }
}
