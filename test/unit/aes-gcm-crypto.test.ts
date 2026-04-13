import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  AesGcmPayloadCryptoService,
  AesGcmPayloadCryptoError,
  StaticAesGcmEncryptionKeyResolver,
} from "../../src/services/aes-gcm-payload-crypto.service.ts";

function createService(keys: Record<string, string> = {}) {
  const resolver = new StaticAesGcmEncryptionKeyResolver(keys);
  return new AesGcmPayloadCryptoService(resolver);
}

// --- Encrypt / Decrypt roundtrip ---

test("AesGcmPayloadCryptoService encrypt and decrypt roundtrip", async () => {
  const key = randomBytes(32).toString("base64");
  const service = createService({ "key-1": key });
  const plaintext = Buffer.from(JSON.stringify({ message: "hello world" }));

  const envelope = await service.encryptJsonEnvelope(plaintext, "key-1");
  assert.equal(envelope.encrypted, true);
  assert.equal(envelope.keyId, "key-1");
  assert.equal(envelope.algorithm, "aes-256-gcm");
  assert.ok(envelope.nonceBase64);
  assert.ok(envelope.ciphertextBase64);

  const result = await service.decryptJsonEnvelope(envelope);
  assert.equal(result.keyId, "key-1");
  assert.deepEqual(result.plaintext, plaintext);
});

test("AesGcmPayloadCryptoService algorithm getter returns aes-256-gcm", () => {
  const service = createService();
  assert.equal(service.algorithm, "aes-256-gcm");
});

// --- Decrypt envelope validation ---

test("AesGcmPayloadCryptoService rejects envelope missing encrypted field", async () => {
  const service = createService({ "key-1": randomBytes(32).toString("base64") });

  await assert.rejects(
    () => service.decryptJsonEnvelope({ keyId: "key-1", algorithm: "aes-256-gcm", nonceBase64: "abc", ciphertextBase64: "def" }),
    (error: unknown) =>
      error instanceof AesGcmPayloadCryptoError &&
      error.code === "INVALID_ENVELOPE",
  );
});

test("AesGcmPayloadCryptoService rejects envelope with empty keyId", async () => {
  const service = createService({ "key-1": randomBytes(32).toString("base64") });

  await assert.rejects(
    () => service.decryptJsonEnvelope({ encrypted: true, keyId: "", algorithm: "aes-256-gcm", nonceBase64: "abc", ciphertextBase64: "def" }),
    (error: unknown) =>
      error instanceof AesGcmPayloadCryptoError &&
      error.code === "INVALID_ENVELOPE",
  );
});

test("AesGcmPayloadCryptoService handles non-base64 ciphertext as PAYLOAD_TOO_SMALL", async () => {
  const service = createService({ "key-1": randomBytes(32).toString("base64") });

  // Buffer.from("!!!not-base64!!!", "base64") returns a small buffer, not a throw
  // so the actual error is PAYLOAD_TOO_SMALL rather than INVALID_ENVELOPE
  await assert.rejects(
    () => service.decryptJsonEnvelope({
      encrypted: true,
      keyId: "key-1",
      algorithm: "aes-256-gcm",
      nonceBase64: randomBytes(12).toString("base64"),
      ciphertextBase64: "!!!not-base64!!!",
    }),
    (error: unknown) =>
      error instanceof AesGcmPayloadCryptoError &&
      error.code === "PAYLOAD_TOO_SMALL",
  );
});

// --- Decrypt validation ---

test("AesGcmPayloadCryptoService rejects unsupported algorithm", async () => {
  const service = createService({ "key-1": randomBytes(32).toString("base64") });

  await assert.rejects(
    () => service.decrypt({
      algorithm: "aes-128-cbc",
      keyId: "key-1",
      nonceBase64: randomBytes(12).toString("base64"),
      ciphertext: randomBytes(32),
    }),
    (error: unknown) =>
      error instanceof AesGcmPayloadCryptoError &&
      error.code === "UNSUPPORTED_ALGORITHM",
  );
});

test("AesGcmPayloadCryptoService rejects unknown key", async () => {
  const service = createService({ "key-1": randomBytes(32).toString("base64") });

  await assert.rejects(
    () => service.decrypt({
      algorithm: "aes-256-gcm",
      keyId: "unknown-key",
      nonceBase64: randomBytes(12).toString("base64"),
      ciphertext: randomBytes(32),
    }),
    (error: unknown) =>
      error instanceof AesGcmPayloadCryptoError &&
      error.code === "UNKNOWN_KEY",
  );
});

test("AesGcmPayloadCryptoService rejects payload too small", async () => {
  const key = randomBytes(32).toString("base64");
  const service = createService({ "key-1": key });

  // ciphertext smaller than GCM_TAG_BYTES (16)
  await assert.rejects(
    () => service.decrypt({
      algorithm: "aes-256-gcm",
      keyId: "key-1",
      nonceBase64: randomBytes(12).toString("base64"),
      ciphertext: randomBytes(8),
    }),
    (error: unknown) =>
      error instanceof AesGcmPayloadCryptoError &&
      error.code === "PAYLOAD_TOO_SMALL",
  );
});

test("AesGcmPayloadCryptoService rejects invalid nonce length", async () => {
  const key = randomBytes(32).toString("base64");
  const service = createService({ "key-1": key });

  await assert.rejects(
    () => service.decrypt({
      algorithm: "aes-256-gcm",
      keyId: "key-1",
      nonceBase64: randomBytes(8).toString("base64"), // wrong length
      ciphertext: Buffer.concat([randomBytes(32), randomBytes(16)]), // data + fake tag
    }),
    (error: unknown) =>
      error instanceof AesGcmPayloadCryptoError &&
      error.code === "INVALID_NONCE",
  );
});

test("AesGcmPayloadCryptoService decrypt fails with wrong key (DECRYPT_FAILED)", async () => {
  const key1 = randomBytes(32).toString("base64");
  const key2 = randomBytes(32).toString("base64");
  const encryptService = createService({ "key-1": key1 });
  const decryptService = createService({ "key-1": key2 });

  const plaintext = Buffer.from("secret data");
  const envelope = await encryptService.encryptJsonEnvelope(plaintext, "key-1");

  await assert.rejects(
    () => decryptService.decryptJsonEnvelope(envelope),
    (error: unknown) =>
      error instanceof AesGcmPayloadCryptoError &&
      error.code === "DECRYPT_FAILED",
  );
});

// --- Encrypt validation ---

test("AesGcmPayloadCryptoService encrypt rejects empty keyId", async () => {
  const service = createService({ "key-1": randomBytes(32).toString("base64") });

  await assert.rejects(
    () => service.encryptJsonEnvelope(Buffer.from("test"), "  "),
    (error: unknown) =>
      error instanceof AesGcmPayloadCryptoError &&
      error.code === "UNKNOWN_KEY",
  );
});

test("AesGcmPayloadCryptoService encrypt trims keyId whitespace", async () => {
  const key = randomBytes(32).toString("base64");
  const service = createService({ "key-1": key });
  const plaintext = Buffer.from("test");

  const envelope = await service.encryptJsonEnvelope(plaintext, "  key-1  ");
  assert.equal(envelope.keyId, "key-1");

  const result = await service.decryptJsonEnvelope(envelope);
  assert.deepEqual(result.plaintext, plaintext);
});

// --- StaticAesGcmEncryptionKeyResolver ---

test("StaticAesGcmEncryptionKeyResolver ignores invalid base64 keys", () => {
  const resolver = new StaticAesGcmEncryptionKeyResolver({ "valid": randomBytes(32).toString("base64"), "invalid": "!!!not-base64!!!" });
  assert.ok(resolver.resolveKey("valid"));
  assert.equal(resolver.resolveKey("invalid"), undefined);
});

test("StaticAesGcmEncryptionKeyResolver ignores keys that are not 32 bytes", () => {
  const resolver = new StaticAesGcmEncryptionKeyResolver({ "short": randomBytes(16).toString("base64"), "correct": randomBytes(32).toString("base64") });
  assert.equal(resolver.resolveKey("short"), undefined);
  assert.ok(resolver.resolveKey("correct"));
});

test("StaticAesGcmEncryptionKeyResolver ignores empty keyId or secret", () => {
  const resolver = new StaticAesGcmEncryptionKeyResolver({ "": randomBytes(32).toString("base64"), "  ": "secret" });
  // Should not have any usable keys
  assert.equal(resolver.resolveKey(""), undefined);
  assert.equal(resolver.resolveKey("  "), undefined);
});
