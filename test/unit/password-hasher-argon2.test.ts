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

test("password hasher accepts bounded scrypt parameters from historical accounts", () => {
  const hasher = new DevelopmentPasswordHasher();
  const salt = "00112233445566778899aabbccddeeff";
  const options = { N: 8192, r: 8, p: 2 };
  const digest = scryptSync("BodyLog123", salt, 64, options).toString("hex");
  const storedHash = `scrypt$${options.N}$${options.r}$${options.p}$${salt}$${digest}`;

  assert.equal(hasher.verify("BodyLog123", storedHash), true);
  assert.equal(hasher.verify("Wrong123", storedHash), false);
  assert.equal(hasher.verify("BodyLog123", `scrypt$8193$8$2$${salt}$${digest}`), false);
  assert.equal(hasher.verify("BodyLog123", `scrypt$8192$8$4000$${salt}$${digest}`), false);
  assert.equal(hasher.verify("BodyLog123", `scrypt$${salt}$abc`), false);
});
