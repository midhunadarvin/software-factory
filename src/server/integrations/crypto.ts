import { createHmac, timingSafeEqual } from "node:crypto";

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function hmacSha256Hex(secret: string, body: Buffer | string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyGithubSignature(secret: string, body: Buffer, header: string | null): boolean {
  if (!secret || !header) return false;
  const expected = `sha256=${hmacSha256Hex(secret, body)}`;
  return safeEqual(expected, header.trim());
}

export function verifyLinearSignature(secret: string, body: Buffer, header: string | null): boolean {
  if (!secret || !header) return false;
  return safeEqual(hmacSha256Hex(secret, body), header.trim());
}

export function verifySharedSecret(secret: string, provided: string | null): boolean {
  if (!secret || !provided) return false;
  return safeEqual(secret, provided);
}

export function secretFromEnv(name: string): string {
  return process.env[name] ?? "";
}

export function missingSecret(envName: string): { ok: false; status: 503; error: string } {
  return { ok: false, status: 503, error: `${envName} is not set` };
}
