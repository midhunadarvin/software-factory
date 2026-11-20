import { describe, expect, it } from "vitest";
import { RunQueue } from "./queue";

describe("RunQueue", () => {
  it("lets one impl and two planning graphs run at once", async () => {
    const q = new RunQueue();
    const a = await q.acquire("planning");
    const b = await q.acquire("planning");
    const impl = await q.acquire("impl");
    expect(q.queued).toBe(0);
    const waiter = q.acquire("planning");
    const implWaiter = q.acquire("impl");
    await Promise.resolve();
    expect(q.queued).toBe(2);
    a();
    await waiter;
    expect(q.queued).toBe(1);
    impl();
    await implWaiter;
    expect(q.queued).toBe(0);
    b();
  });

  it("wakes the first matching waiter when a slot frees", async () => {
    const q = new RunQueue();
    const first = await q.acquire("impl");
    let started = false;
    const pending = q.acquire("impl").then(() => {
      started = true;
    });
    await Promise.resolve();
    expect(started).toBe(false);
    expect(q.queued).toBe(1);
    first();
    await pending;
    expect(started).toBe(true);
    expect(q.queued).toBe(0);
  });
});
