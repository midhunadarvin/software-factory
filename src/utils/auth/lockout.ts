type Bucket = { failures: number; firstAt: number };

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const buckets = new Map<string, Bucket>();

export function lockoutKey(ip: string): string {
  return ip || "unknown";
}

export function isLocked(ip: string): boolean {
  const b = buckets.get(lockoutKey(ip));
  if (!b) return false;
  if (Date.now() - b.firstAt > WINDOW_MS) {
    buckets.delete(lockoutKey(ip));
    return false;
  }
  return b.failures >= MAX_FAILURES;
}

export function recordFailure(ip: string): void {
  const key = lockoutKey(ip);
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.firstAt > WINDOW_MS) {
    buckets.set(key, { failures: 1, firstAt: now });
    return;
  }
  b.failures += 1;
}

export function recordSuccess(ip: string): void {
  buckets.delete(lockoutKey(ip));
}

export function resetLockouts(): void {
  buckets.clear();
}
