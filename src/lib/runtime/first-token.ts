export const FIRST_TOKEN_TIMEOUT_MS = 30_000;
export const CLI_IDLE_TIMEOUT_MS = 180_000;

export function firstTokenTimeoutMessage(ms = FIRST_TOKEN_TIMEOUT_MS) {
  return `No tokens from the model within ${Math.round(ms / 1000)}s`;
}

export function idleTimeoutMessage(ms = CLI_IDLE_TIMEOUT_MS) {
  return `No output from the coding CLI for ${Math.round(ms / 1000)}s`;
}

export function startStreamWatch(opts: {
  firstMs?: number;
  idleMs?: number;
  onTimeout: (kind: "first" | "idle") => void;
}) {
  let kind: "first" | "idle" = "first";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cleared = false;
  const firstMs = opts.firstMs ?? FIRST_TOKEN_TIMEOUT_MS;
  const idleMs = opts.idleMs ?? CLI_IDLE_TIMEOUT_MS;

  const arm = (next: "first" | "idle") => {
    if (cleared) return;
    kind = next;
    if (timer) clearTimeout(timer);
    const ms = next === "first" ? firstMs : idleMs;
    if (ms <= 0) {
      timer = undefined;
      return;
    }
    timer = setTimeout(() => {
      if (!cleared) opts.onTimeout(kind);
    }, ms);
  };

  arm("first");
  return {
    noteToken() {
      arm("idle");
    },
    clear() {
      cleared = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export function startFirstTokenWatch(opts: { ms?: number; onTimeout: () => void }) {
  return startStreamWatch({
    firstMs: opts.ms,
    idleMs: 0,
    onTimeout: (kind) => {
      if (kind === "first") opts.onTimeout();
    },
  });
}
