import { createHmac } from "node:crypto";
import { loadEnv, type FactoryKeys } from "../env";

function hkdfSha256(secret: Buffer, info: string): Buffer {
  const salt = Buffer.from("software-factory-v1");
  const prk = createHmac("sha256", salt).update(secret).digest();
  const infoBuf = Buffer.from(info);
  const t = createHmac("sha256", prk)
    .update(Buffer.concat([infoBuf, Buffer.from([1])]))
    .digest();
  return t.subarray(0, 32);
}

export function deriveKeys(secret = loadEnv().secret): FactoryKeys {
  const old = loadEnv().secretOld;
  return {
    aesPat: hkdfSha256(secret, "factory:aes-pat"),
    hmacSession: hkdfSha256(secret, "factory:hmac-session"),
    aesPatOld: old ? hkdfSha256(old, "factory:aes-pat") : null,
  };
}
