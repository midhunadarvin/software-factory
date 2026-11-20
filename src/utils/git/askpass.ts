import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function writeAskpassScript(pat: string): { script: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-askpass-"));
  const script = path.join(dir, "askpass.sh");
  const tokenFile = path.join(dir, "token");
  fs.writeFileSync(tokenFile, pat, { mode: 0o600 });
  fs.writeFileSync(script, `#!/bin/sh\ncat "${tokenFile}"\n`, { mode: 0o700 });
  return {
    script,
    cleanup: () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function gitEnvWithAskpass(pat: string | null | undefined): {
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
} {
  if (!pat) {
    return { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, cleanup: () => {} };
  }
  const { script, cleanup } = writeAskpassScript(pat);
  return {
    env: {
      ...process.env,
      GIT_ASKPASS: script,
      GIT_TERMINAL_PROMPT: "0",
    },
    cleanup,
  };
}
