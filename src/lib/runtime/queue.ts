type Kind = "impl" | "planning";

export class RunQueue {
  private impl = 0;
  private planning = 0;
  private waiters: { kind: Kind; resolve: () => void }[] = [];

  get queued(): number {
    return this.waiters.length;
  }

  async acquire(kind: Kind): Promise<() => void> {
    const tryTake = () => {
      if (kind === "impl" && this.impl < 1) {
        this.impl += 1;
        return true;
      }
      if (kind === "planning" && this.planning < 2) {
        this.planning += 1;
        return true;
      }
      return false;
    };
    if (tryTake()) {
      return () => this.release(kind);
    }
    await new Promise<void>((resolve) => this.waiters.push({ kind, resolve }));
    return () => this.release(kind);
  }

  private release(kind: Kind) {
    if (kind === "impl") this.impl = Math.max(0, this.impl - 1);
    else this.planning = Math.max(0, this.planning - 1);
    const idx = this.waiters.findIndex((w) => {
      if (w.kind === "impl") return this.impl < 1;
      return this.planning < 2;
    });
    if (idx >= 0) {
      const [w] = this.waiters.splice(idx, 1);
      if (w.kind === "impl") this.impl += 1;
      else this.planning += 1;
      w.resolve();
    }
  }
}
