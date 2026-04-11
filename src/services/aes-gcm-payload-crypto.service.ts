import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const AES_256_GCM = "aes-256-gcm";
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

export interface AesGcmEncryptionKeyResolver {
  resolveKey(keyId: string): Promise<Buffer | undefined> | Buffer | undefined;
}

export class CompositeAesGcmEncryptionKeyResolver implements AesGcmEncryptionKeyResolver {
  constructor(private readonly resolvers: AesGcmEncryptionKeyResolver[]) {}

  async resolveKey(keyId: string): Promise<Buffer | undefined> {
    for (const resolver of this.resolvers) {
      const resolved = await resolver.resolveKey(keyId);
      if (resolved) {
        return resolved;
      }
    }

    return undefined;
  }
}

export class StaticAesGcmEncryptionKeyResolver implements AesGcmEncryptionKeyResolver {
  private readonly normalized = new Map<string, Buffer>();

  constructor(keys: Record<string, string> = {}) {
    for (const [keyId, secretBase64] of Object.entries(keys)) {
      const normalizedKeyId = keyId.trim();
      const normalizedSecret = secretBase64.trim();
      if (!normalizedKeyId || !normalizedSecret) {
        continue;
      }

      try {
        const key = Buffer.from(normalizedSecret, "base64");
        if (key.length === 32) {
          this.normalized.set(normalizedKeyId, key);
        }
      } catch {
        // Ignore invalid bootstrap keys and behave as if the key does not exist.
      }
    }
  }

  resolveKey(keyId: string): Buffer | undefined {
    return this.normalized.get(keyId.trim());
  }
}

export interface AesGcmJsonEnvelope {
  encrypted: true;
  keyId: string;
  algorithm: string;
  nonceBase64: string;
  ciphertextBase64: string;
}

export type AesGcmPayloadCryptoErrorCode =
  | "INVALID_ENVELOPE"
  | "UNSUPPORTED_ALGORITHM"
  | "INVALID_NONCE"
  | "UNKNOWN_KEY"
  | "PAYLOAD_TOO_SMALL"
  | "DECRYPT_FAILED"
  | "ENCRYPT_FAILED";

export class AesGcmPayloadCryptoError extends Error {
  constructor(
    public readonly code: AesGcmPayloadCryptoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AesGcmPayloadCryptoError";
  }
}

export class AesGcmPayloadCryptoService {
  constructor(private readonly keyResolver: AesGcmEncryptionKeyResolver) {}

  get algorithm(): string {
    return AES_256_GCM;
  }

  async decryptJsonEnvelope(envelope: Record<string, unknown>): Promise<{ keyId: string; plaintext: Buffer }> {
    const encrypted = envelope.encrypted;
    const keyId = typeof envelope.keyId === "string" ? envelope.keyId.trim() : "";
    const algorithm = typeof envelope.algorithm === "string" ? envelope.algorithm.trim() : "";
    const nonceBase64 = typeof envelope.nonceBase64 === "string" ? envelope.nonceBase64.trim() : "";
    const ciphertextBase64 =
      typeof envelope.ciphertextBase64 === "string" ? envelope.ciphertextBase64.trim() : "";

    if (encrypted !== true || !keyId || !algorithm || !nonceBase64 || !ciphertextBase64) {
      throw new AesGcmPayloadCryptoError(
        "INVALID_ENVELOPE",
        "Encrypted AI request envelope is invalid.",
      );
    }

    let ciphertext: Buffer;
    try {
      ciphertext = Buffer.from(ciphertextBase64, "base64");
    } catch {
      throw new AesGcmPayloadCryptoError(
        "INVALID_ENVELOPE",
        "Encrypted AI request ciphertext must be valid base64.",
      );
    }

    return {
      keyId,
      plaintext: await this.decrypt({
        algorithm,
        keyId,
        nonceBase64,
        ciphertext,
      }),
    };
  }

  async encryptJsonEnvelope(payload: Buffer, keyId: string): Promise<AesGcmJsonEnvelope> {
    const normalizedKeyId = keyId.trim();
    if (!normalizedKeyId) {
      throw new AesGcmPayloadCryptoError("UNKNOWN_KEY", "Missing encryption key id.");
    }

    const key = await this.resolveKey(normalizedKeyId);
    const nonce = randomBytes(GCM_NONCE_BYTES);

    try {
      const cipher = createCipheriv(AES_256_GCM, key, nonce);
      const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
      const authTag = cipher.getAuthTag();

      return {
        encrypted: true,
        keyId: normalizedKeyId,
        algorithm: AES_256_GCM,
        nonceBase64: nonce.toString("base64"),
        ciphertextBase64: Buffer.concat([ciphertext, authTag]).toString("base64"),
      };
    } catch {
      throw new AesGcmPayloadCryptoError("ENCRYPT_FAILED", "Unable to encrypt the AI payload.");
    }
  }

  async decrypt(input: {
    algorithm: string;
    keyId: string;
    nonceBase64: string;
    ciphertext: Buffer;
  }): Promise<Buffer> {
    const algorithm = input.algorithm.trim();
    if (algorithm !== AES_256_GCM) {
      throw new AesGcmPayloadCryptoError(
        "UNSUPPORTED_ALGORITHM",
        `Unsupported encryption algorithm: ${input.algorithm}.`,
      );
    }

    const nonce = this.decodeNonce(input.nonceBase64);
    const key = await this.resolveKey(input.keyId);

    if (input.ciphertext.length <= GCM_TAG_BYTES) {
      throw new AesGcmPayloadCryptoError(
        "PAYLOAD_TOO_SMALL",
        "Encrypted payload is too small.",
      );
    }

    const ciphertext = input.ciphertext.subarray(0, input.ciphertext.length - GCM_TAG_BYTES);
    const authTag = input.ciphertext.subarray(input.ciphertext.length - GCM_TAG_BYTES);

    try {
      const decipher = createDecipheriv(AES_256_GCM, key, nonce);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new AesGcmPayloadCryptoError(
        "DECRYPT_FAILED",
        "Unable to decrypt the encrypted payload.",
      );
    }
  }

  private decodeNonce(value: string): Buffer {
    let nonce: Buffer;
    try {
      nonce = Buffer.from(value, "base64");
    } catch {
      throw new AesGcmPayloadCryptoError("INVALID_NONCE", "Nonce must be valid base64.");
    }

    if (nonce.length !== GCM_NONCE_BYTES) {
      throw new AesGcmPayloadCryptoError("INVALID_NONCE", "Nonce must decode to 12 bytes.");
    }

    return nonce;
  }

  private async resolveKey(keyId: string): Promise<Buffer> {
    const resolved = await this.keyResolver.resolveKey(keyId);
    if (!resolved || resolved.length !== 32) {
      throw new AesGcmPayloadCryptoError(
        "UNKNOWN_KEY",
        `Unknown or invalid encryption key: ${keyId}.`,
      );
    }

    return resolved;
  }
}
