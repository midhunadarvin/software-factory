import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { deriveKeys } from "../crypto/hkdf";
import { loadEnv } from "../env";

const TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "factory_session";

function passwordBinding(password: string): string {
  return createHash("sha256").update(password).digest("hex").slice(0, 16);
}

function sign(exp: string, rand: string): string {
  const { hmacSession } = deriveKeys();
  const bind = passwordBinding(loadEnv().appPassword);
  return createHmac("sha256", hmacSession)
    .update(`${exp}${rand}${bind}`)
    .digest("hex");
}

export function issueSession(): string {
  const exp = String(Date.now() + TTL_MS);
  const rand = randomBytes(16).toString("hex");
  const mac = sign(exp, rand);
  return `${exp}.${rand}.${mac}`;
}

export function verifySession(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [exp, rand, mac] = parts;
  if (!exp || !rand || !mac) return false;
  if (Number(exp) < Date.now()) return false;
  const expected = sign(exp, rand);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function passwordsMatch(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function cookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}
