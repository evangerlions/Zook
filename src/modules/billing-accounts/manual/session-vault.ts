import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { KVManager } from "../../../infrastructure/kv/kv-manager.ts";
import { ApplicationError } from "../../../shared/errors.ts";
/** Browser state is encrypted separately from account configuration and never returned by Admin APIs. */
export class SessionVault {
  private readonly keys: Buffer[];
  constructor(private readonly kv: KVManager, secrets: string[]) {
    this.keys = secrets.map(secret => Buffer.from(hkdfSync("sha256", secret, "zook", "billing-browser-state-v1", 32)));
  }
  ready() { return this.keys.length > 0; }
  async save(accountId: string, state: string) {
    if (!this.ready()) throw new ApplicationError(503, "REQ_INVALID_BODY", "Stable encryption configuration is required for browser sessions.");
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.keys[0], iv);
    cipher.setAAD(Buffer.from(accountId));
    const data = Buffer.concat([cipher.update(state), cipher.final()]);
    await this.kv.setString("billing-browser-state", accountId, [iv, cipher.getAuthTag(), data].map(b => b.toString("base64")).join("."), 30 * 86400);
  }
  async load(accountId: string): Promise<string | undefined> {
    const raw = await this.kv.getString("billing-browser-state", accountId); if (!raw) return;
    const [iv, tag, data] = raw.split(".").map(value => Buffer.from(value, "base64"));
    for (const [index, key] of this.keys.entries()) {
      try {
        const cipher = createDecipheriv("aes-256-gcm", key, iv); cipher.setAAD(Buffer.from(accountId)); cipher.setAuthTag(tag);
        const state = Buffer.concat([cipher.update(data), cipher.final()]).toString();
        if (index > 0) {
          // CAS prevents a delayed key rotation from replacing a newer successful login.
          const nonce = randomBytes(12), wrapper = createCipheriv("aes-256-gcm", this.keys[0], nonce); wrapper.setAAD(Buffer.from(accountId));
          const sealed = Buffer.concat([wrapper.update(state), wrapper.final()]);
          await this.kv.applyAtomic("billing-browser-state", { compare: [{ key: accountId, value: raw }], set: [{ key: accountId,
            value: [nonce, wrapper.getAuthTag(), sealed].map(b => b.toString("base64")).join("."), ttlSeconds: 30 * 86400 }] });
        }
        return state;
      } catch { /* Try a configured previous encryption key. */ }
    }
    throw new ApplicationError(409, "REQ_INVALID_BODY", "Saved browser session could not be decrypted. Clear it and sign in again.");
  }
  clear(accountId: string) { return this.kv.delete("billing-browser-state", accountId); }
}
