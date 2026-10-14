import assert from "node:assert/strict";
import { generateKeyPairSync, createPrivateKey, createPublicKey } from "node:crypto";
import test from "node:test";
import { normalizeAlipayPrivateKey } from "../../src/modules/billing/alipay-key-format.ts";

test("Chat raw PKCS8 and PKCS1 and PEM retain the exact signing identity", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const expected = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  for (const type of ["pkcs1", "pkcs8"] as const) {
    for (const input of [privateKey.export({ type, format: "pem" }).toString(),
      privateKey.export({ type, format: "der" }).toString("base64")]) {
      const result = normalizeAlipayPrivateKey(input);
      assert.ok(result.includes("BEGIN PRIVATE KEY"));
      assert.deepEqual(createPublicKey(createPrivateKey(result)).export({ type: "spki", format: "der" }), expected);
    }
  }
  assert.throws(() => normalizeAlipayPrivateKey("not-a-key"), /Alipay private key format is invalid/);
});
