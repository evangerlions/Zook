import { randomBytes } from "node:crypto";
import type { KVManager } from "../../../infrastructure/kv/kv-manager.ts";
import type { AesGcmEncryptionKeyResolver } from "../../../services/aes-gcm-payload-crypto.service.ts";
const SCOPE = "lighttick-personal-model-master-keys",
  KEY = "v1";
/** Server-only master key. Never use a client-upload/public encryption key for credentials. */
export class PersonalModelKeyResolver implements AesGcmEncryptionKeyResolver {
  constructor(readonly kv: KVManager) {}
  async ensure() {
    await this.kv.setStringIfAbsent(
      SCOPE,
      KEY,
      randomBytes(32).toString("base64"),
    );
    if (!(await this.resolveKey(KEY)))
      throw Error("Personal model master key unavailable");
    return KEY;
  }
  async resolveKey(id: string) {
    if (id !== KEY) return undefined;
    const raw = await this.kv.getString(SCOPE, KEY);
    if (!raw) return undefined;
    const key = Buffer.from(raw, "base64");
    return key.length === 32 ? key : undefined;
  }
}
