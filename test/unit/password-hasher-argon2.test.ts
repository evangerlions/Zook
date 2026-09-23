import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import test from "node:test";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";

test("password hasher creates and verifies Argon2id hashes", () => {
  const hasher = new DevelopmentPasswordHasher();
  const hash = hasher.hash("BodyLog123");

  assert.match(hash, /^\$argon2id\$/);
  assert.equal(hasher.verify("BodyLog123", hash), true);
  assert.equal(hasher.verify("Wrong123", hash), false);
  assert.equal(hasher.algorithm, "argon2id");
});

test("password hasher keeps verifying legacy scrypt hashes", () => {
  const hasher = new DevelopmentPasswordHasher();
  const salt = "00112233445566778899aabbccddeeff";
  const digest = scryptSync("BodyLog123", salt, 64).toString("hex");
  const legacyHash = `scrypt$${salt}$${digest}`;

  assert.equal(hasher.canVerify("scrypt"), true);
  assert.equal(hasher.verify("BodyLog123", legacyHash), true);
  assert.equal(hasher.verify("Wrong123", legacyHash), false);
});
