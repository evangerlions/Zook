import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ApplicationError } from "../../shared/errors.ts";
import { strictObject } from "../../shared/strict-object.ts";
export interface AccountLogin { username: string; password: string; }
export function loginPatch(value: unknown): Partial<AccountLogin> {
  const b = strictObject(value, ["username", "password"]);
  if ((b.username !== undefined && (typeof b.username !== "string" || !b.username.trim() || b.username.length > 256)) ||
      (b.password !== undefined && (typeof b.password !== "string" || !b.password || b.password.length > 1000))) throw new ApplicationError(400, "REQ_INVALID_BODY", "Invalid saved login credentials.");
  return { ...(b.username !== undefined ? { username: (b.username as string).trim() } : {}), ...(b.password !== undefined ? { password: b.password as string } : {}) };
}
export function sealLogin(login: AccountLogin, key: Buffer | undefined, accountId: string) {
  if (!key) throw new ApplicationError(503, "REQ_INVALID_BODY", "Stable account encryption must be configured.");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(Buffer.from(`login:${accountId}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(login)), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString("base64")).join(".");
}
export function openLogin(value: string, keys: Buffer[], accountId: string): { login: AccountLogin; keyIndex: number } {
  const [iv, tag, ciphertext] = value.split(".").map(s => Buffer.from(s, "base64"));
  for (const [keyIndex, key] of keys.entries()) {
    try {
      const cipher = createDecipheriv("aes-256-gcm", key, iv); cipher.setAAD(Buffer.from(`login:${accountId}`)); cipher.setAuthTag(tag);
      const login = loginPatch(JSON.parse(Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString()));
      if (login.username && login.password) return { login: login as AccountLogin, keyIndex };
    } catch { /* Try previous configured encryption keys. */ }
  }
  throw new ApplicationError(409, "REQ_INVALID_BODY", "Saved account login could not be decrypted. Update its credentials.");
}
