import fs from "node:fs";
import { runtimeLockPath } from "../paths";

export function acquirePidfile(): void {
  const p = runtimeLockPath();
  try {
    const fd = fs.openSync(p, "wx");
    fs.writeFileSync(fd, `${process.pid}\n`);
    fs.closeSync(fd);
    return;
  } catch {
    if (!fs.existsSync(p)) throw new Error("could not create runtime lock");
    const raw = fs.readFileSync(p, "utf8").trim();
    const pid = Number(raw);
    if (pid && isAlive(pid)) {
      throw new Error(`another FactoryRuntime is alive (pid ${pid})`);
    }
    fs.writeFileSync(p, `${process.pid}\n`);
  }
}

export function readDeadPid(): number | null {
  const p = runtimeLockPath();
  if (!fs.existsSync(p)) return null;
  const pid = Number(fs.readFileSync(p, "utf8").trim());
  if (!pid) return null;
  return isAlive(pid) ? null : pid;
}

export function releasePidfile(): void {
  try {
    const p = runtimeLockPath();
    if (!fs.existsSync(p)) return;
    const pid = Number(fs.readFileSync(p, "utf8").trim());
    if (pid === process.pid) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
