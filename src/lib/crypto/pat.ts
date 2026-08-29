import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { deriveKeys } from "./hkdf";

export type EncryptedPat = {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
};

export function encryptPat(projectId: string, pat: string): EncryptedPat {
  const { aesPat } = deriveKeys();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesPat, iv);
  cipher.setAAD(Buffer.from(`project:${projectId}:github_pat`));
  const ciphertext = Buffer.concat([cipher.update(pat, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

export function decryptPat(
  projectId: string,
  enc: EncryptedPat,
): string {
  const keys = deriveKeys();
  const tryKey = (key: Buffer) => {
    const decipher = createDecipheriv("aes-256-gcm", key, enc.iv);
    decipher.setAAD(Buffer.from(`project:${projectId}:github_pat`));
    decipher.setAuthTag(enc.tag);
    return Buffer.concat([decipher.update(enc.ciphertext), decipher.final()]).toString(
      "utf8",
    );
  };
  try {
    return tryKey(keys.aesPat);
  } catch {
    if (!keys.aesPatOld) throw new Error("failed to decrypt PAT");
    return tryKey(keys.aesPatOld);
  }
}
