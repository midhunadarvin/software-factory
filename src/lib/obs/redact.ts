const PATTERNS = [/ghp_[A-Za-z0-9_]+/g, /gho_[A-Za-z0-9_]+/g, /sk-[A-Za-z0-9_-]+/g, /xai-[A-Za-z0-9_-]+/g];

export function redact(text: string): string {
  let out = text;
  for (const p of PATTERNS) out = out.replace(p, "[redacted]");
  return out;
}
