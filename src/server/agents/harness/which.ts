import { spawn } from "node:child_process";

export function whichBinary(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("which", [name], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      const path = out.trim().split("\n")[0]?.trim();
      resolve(code === 0 && path ? path : null);
    });
  });
}
