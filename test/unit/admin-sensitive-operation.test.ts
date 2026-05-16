import assert from "node:assert/strict";
import test from "node:test";
import { KVManager, InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { AdminSensitiveOperationService } from "../../src/services/admin-sensitive-operation.service.ts";
import type { AdminSessionRecord } from "../../src/shared/types.ts";

const TEST_SESSION: AdminSessionRecord = {
  id: "session_1",
  username: "admin",
  createdAt: "2026-04-13T00:00:00.000Z",
  expiresAt: "2026-04-27T00:00:00.000Z",
};

async function createService(options = {}) {
  const kvManager = await KVManager.create({ kvBackend: new InMemoryKVBackend() });
  return { service: new AdminSensitiveOperationService(kvManager, { secondaryPassword: "123456", ...options }), kvManager };
}

// --- Request code ---

test("AdminSensitiveOperationService requestCode issues a code request document", async () => {
  const { service } = await createService();
  const now = new Date("2026-04-13T10:00:00+08:00");

  const doc = await service.requestCode(TEST_SESSION, "delete_app", now);
  assert.equal(doc.operation, "delete_app");
  assert.equal(doc.recipientEmailMasked, "secondary-password");
  assert.equal(doc.cooldownSeconds, 60);
  assert.equal(doc.expiresInSeconds, 600);
});

test("AdminSensitiveOperationService requestCode enforces resend cooldown", async () => {
  const { service } = await createService();
  const baseTime = new Date("2026-04-13T10:00:00+08:00");

  await service.requestCode(TEST_SESSION, "delete_app", baseTime);

  await assert.rejects(
    () => service.requestCode(TEST_SESSION, "delete_app", new Date(baseTime.getTime() + 30 * 1000)),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ADMIN_SENSITIVE_RATE_LIMITED",
  );
});

test("AdminSensitiveOperationService requestCode allows resend after cooldown", async () => {
  const { service } = await createService();
  const baseTime = new Date("2026-04-13T10:00:00+08:00");

  await service.requestCode(TEST_SESSION, "delete_app", baseTime);
  const doc = await service.requestCode(TEST_SESSION, "delete_app", new Date(baseTime.getTime() + 61 * 1000));
  assert.equal(doc.operation, "delete_app");
});

// --- Verify code ---

test("AdminSensitiveOperationService verifyCode grants on correct code", async () => {
  const { service } = await createService();
  const baseTime = new Date("2026-04-13T10:00:00+08:00");

  await service.requestCode(TEST_SESSION, "delete_app", baseTime);

  const grant = await service.verifyCode(TEST_SESSION, "delete_app", "123456", new Date(baseTime.getTime() + 5 * 1000));
  assert.equal(grant.granted, true);
  assert.equal(grant.operation, "delete_app");
  assert.ok(grant.expiresAt);
});

test("AdminSensitiveOperationService verifyCode rejects wrong code", async () => {
  const { service } = await createService();
  const baseTime = new Date("2026-04-13T10:00:00+08:00");

  await service.requestCode(TEST_SESSION, "delete_app", baseTime);

  await assert.rejects(
    () => service.verifyCode(TEST_SESSION, "delete_app", "000000", new Date(baseTime.getTime() + 5 * 1000)),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ADMIN_SENSITIVE_CODE_INVALID",
  );
});

test("AdminSensitiveOperationService verifyCode rejects expired code", async () => {
  const { service } = await createService({ codeTtlMs: 1000 });
  const baseTime = new Date("2026-04-13T10:00:00+08:00");

  await service.requestCode(TEST_SESSION, "delete_app", baseTime);

  await assert.rejects(
    () => service.verifyCode(TEST_SESSION, "delete_app", "123456", new Date(baseTime.getTime() + 2000)),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ADMIN_SENSITIVE_CODE_INVALID",
  );
});

test("AdminSensitiveOperationService verifyCode rejects after max failed attempts", async () => {
  const { service } = await createService({ maxFailedAttempts: 2 });
  const baseTime = new Date("2026-04-13T10:00:00+08:00");

  await service.requestCode(TEST_SESSION, "delete_app", baseTime);

  // First wrong attempt
  await assert.rejects(
    () => service.verifyCode(TEST_SESSION, "delete_app", "000000", new Date(baseTime.getTime() + 1000)),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ADMIN_SENSITIVE_CODE_INVALID",
  );

  // Second wrong attempt (hits max)
  await assert.rejects(
    () => service.verifyCode(TEST_SESSION, "delete_app", "000000", new Date(baseTime.getTime() + 2000)),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ADMIN_SENSITIVE_CODE_INVALID",
  );

  // Even correct code should fail now (code was deleted)
  await assert.rejects(
    () => service.verifyCode(TEST_SESSION, "delete_app", "123456", new Date(baseTime.getTime() + 3000)),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ADMIN_SENSITIVE_CODE_INVALID",
  );
});

test("AdminSensitiveOperationService verifyCode rejects empty code", async () => {
  const { service } = await createService();
  const baseTime = new Date("2026-04-13T10:00:00+08:00");

  await assert.rejects(
    () => service.verifyCode(TEST_SESSION, "delete_app", "", baseTime),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ADMIN_SENSITIVE_CODE_REQUIRED",
  );
});

test("AdminSensitiveOperationService verifyCode trims whitespace from code", async () => {
  const { service } = await createService();
  const baseTime = new Date("2026-04-13T10:00:00+08:00");

  await service.requestCode(TEST_SESSION, "delete_app", baseTime);

  const grant = await service.verifyCode(TEST_SESSION, "delete_app", "  123456  ", new Date(baseTime.getTime() + 5 * 1000));
  assert.equal(grant.granted, true);
});

// --- Assert granted ---

test("AdminSensitiveOperationService assertGranted passes for a granted operation", async () => {
  const { service } = await createService();
  const baseTime = new Date("2026-04-13T10:00:00+08:00");

  await service.requestCode(TEST_SESSION, "delete_app", baseTime);
  await service.verifyCode(TEST_SESSION, "delete_app", "123456", new Date(baseTime.getTime() + 5 * 1000));

  // Should not throw
  await service.assertGranted(TEST_SESSION, "delete_app", new Date(baseTime.getTime() + 10 * 1000));
});

test("AdminSensitiveOperationService assertGranted rejects ungranted operation", async () => {
  const { service } = await createService();

  await assert.rejects(
    () => service.assertGranted(TEST_SESSION, "delete_app"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ADMIN_SENSITIVE_OPERATION_REQUIRED" &&
      error.statusCode === 403,
  );
});

test("AdminSensitiveOperationService assertGranted rejects expired grant", async () => {
  const { service } = await createService({ grantTtlMs: 1000 });
  const baseTime = new Date("2026-04-13T10:00:00+08:00");

  await service.requestCode(TEST_SESSION, "delete_app", baseTime);
  const verifyTime = new Date(baseTime.getTime() + 100);
  await service.verifyCode(TEST_SESSION, "delete_app", "123456", verifyTime);

  // Grant expires at verifyTime + 1000ms
  await assert.rejects(
    () => service.assertGranted(TEST_SESSION, "delete_app", new Date(verifyTime.getTime() + 2000)),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ADMIN_SENSITIVE_OPERATION_REQUIRED",
  );
});

// --- Operation normalization ---

test("AdminSensitiveOperationService normalizes operation name with dots and colons", async () => {
  const { service } = await createService();
  const baseTime = new Date("2026-04-13T10:00:00+08:00");

  await service.requestCode(TEST_SESSION, "  app.delete:v1  ", baseTime);
  const grant = await service.verifyCode(TEST_SESSION, "app.delete:v1", "123456", new Date(baseTime.getTime() + 5 * 1000));
  assert.equal(grant.operation, "app.delete:v1");
});

test("AdminSensitiveOperationService rejects empty operation name", async () => {
  const { service } = await createService();

  await assert.rejects(
    () => service.requestCode(TEST_SESSION, "", new Date()),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

test("AdminSensitiveOperationService rejects operation with invalid characters", async () => {
  const { service } = await createService();

  await assert.rejects(
    () => service.requestCode(TEST_SESSION, "delete app!", new Date()),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});
