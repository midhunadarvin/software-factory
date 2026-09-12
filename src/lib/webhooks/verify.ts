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

/** GitHub: `X-Hub-Signature-256: sha256=<hex>`. */
export function verifyGithubSignature(secret: string, body: Buffer, header: string | null): boolean {
  if (!secret || !header) return false;
  const expected = `sha256=${hmacSha256Hex(secret, body)}`;
  return safeEqual(expected, header.trim());
}

/** Linear: `Linear-Signature: <hex>`. */
export function verifyLinearSignature(secret: string, body: Buffer, header: string | null): boolean {
  if (!secret || !header) return false;
  return safeEqual(hmacSha256Hex(secret, body), header.trim());
}

/** Jira Cloud webhooks have no HMAC. Operators put the shared secret on the URL or as Bearer. */
export function verifySharedSecret(secret: string, provided: string | null): boolean {
  if (!secret || !provided) return false;
  return safeEqual(secret, provided);
}

export function webhookSecrets() {
  return {
    github: process.env.GITHUB_WEBHOOK_SECRET ?? "",
    linear: process.env.LINEAR_WEBHOOK_SECRET ?? "",
    jira: process.env.JIRA_WEBHOOK_SECRET ?? "",
  };
}
