import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createApplication } from "../support/create-test-application.ts";

function encodeKeyBase64(): { raw: Buffer; base64: string } {
  const raw = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
  return {
    raw,
    base64: raw.toString("base64"),
  };
}

function encryptNdjson(lines: Array<Record<string, unknown>>, key: Buffer) {
  const ndjson = `${lines.map((item) => JSON.stringify(item)).join("\n")}\n`;
  const compressed = gzipSync(Buffer.from(ndjson, "utf8"));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    body: Buffer.concat([ciphertext, tag]),
    nonceBase64: nonce.toString("base64"),
    plainBytes: Buffer.byteLength(ndjson, "utf8"),
    compressedBytes: compressed.length,
    lineCount: lines.length,
  };
}

async function issueAccessToken(runtime: Awaited<ReturnType<typeof createApplication>>) {
  return runtime.services.authService.login({
    appId: "app_a",
    account: "alice@example.com",
    password: "Password1234",
  });
}

async function enableLogPull(runtime: Awaited<ReturnType<typeof createApplication>>) {
  await runtime.services.appRemoteLogPullService.updateConfig("app_a", {
    enabled: true,
    claimTtlSeconds: 300,
    minPullIntervalSeconds: 120,
    taskDefaults: {
      lookbackMinutes: 60,
      maxLines: 2000,
      maxBytes: 1048576,
    },
  });
}

function createTempStorageDir() {
  return mkdtempSync(join(tmpdir(), "zook-log-upload-"));
}

test("logs policy returns defaults and app-level overrides", async () => {
  const runtime = await createApplication();
  const session = await issueAccessToken(runtime);

  const defaultResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/logs/policy",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
    },
  });

  assert.equal(defaultResponse.statusCode, 200);
  assert.deepEqual(defaultResponse.body.data, {
    enabled: false,
    minPullIntervalSeconds: 1800,
  });

  await runtime.services.appRemoteLogPullService.updateConfig("app_a", {
    enabled: true,
    claimTtlSeconds: 300,
    minPullIntervalSeconds: 120,
    taskDefaults: {
      lookbackMinutes: 60,
      maxLines: 2000,
      maxBytes: 1048576,
    },
  });

  const configuredResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/logs/policy",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
    },
  });

  assert.equal(configuredResponse.statusCode, 200);
  assert.deepEqual(configuredResponse.body.data, {
    enabled: true,
    minPullIntervalSeconds: 120,
  });
});

test("logs pull-task returns shouldUpload false when no claimable task exists", async () => {
  const runtime = await createApplication();
  const session = await issueAccessToken(runtime);

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/logs/pull-task",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
      "x-did": "did_alpha",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data, {
    shouldUpload: false,
  });
});

test("logs pull-task claims a task for one client and hides it from concurrent pulls", async () => {
  const key = encodeKeyBase64();
  const runtime = await createApplication({
    logEncryptionKeys: {
      "dev-k1": key.base64,
    },
  });
  const session = await issueAccessToken(runtime);
  await enableLogPull(runtime);

  runtime.database.clientLogUploadTasks.push({
    id: "log-task-claim-001",
    appId: "app_a",
    userId: session.userId,
    keyId: "dev-k1",
    status: "PENDING",
    createdAt: "2026-04-05T12:00:00.000Z",
  });

  const claimed = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/logs/pull-task",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
      "x-did": "did_alpha",
    },
  });

  assert.equal(claimed.statusCode, 200);
  assert.equal(claimed.body.data.shouldUpload, true);
  if (!claimed.body.data.shouldUpload) {
    throw new Error("Expected claimable task.");
  }
  assert.equal(claimed.body.data.taskId, "log-task-claim-001");
  assert.equal(typeof claimed.body.data.claimToken, "string");
  assert.equal(typeof claimed.body.data.claimExpireAtMs, "number");
  assert.equal(runtime.database.clientLogUploadTasks[0]?.status, "CLAIMED");
  assert.equal(runtime.database.clientLogUploadTasks[0]?.did, "did_alpha");

  const hidden = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/logs/pull-task",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
      "x-did": "did_alpha",
    },
  });

  assert.equal(hidden.statusCode, 200);
  assert.deepEqual(hidden.body.data, {
    shouldUpload: false,
  });
});

test("logs upload can decrypt payloads using app-generated log secrets after claim", async () => {
  const storageDir = createTempStorageDir();
  const runtimeWithStorage = await createApplication({ fileStorageRoot: storageDir });
  const sessionWithStorage = await issueAccessToken(runtimeWithStorage);
  await enableLogPull(runtimeWithStorage);
  const appSecret = (await runtimeWithStorage.services.appLogSecretService.ensureSecret("app_a")).record;
  const key = Buffer.from(appSecret.secret, "base64");

  runtimeWithStorage.database.clientLogUploadTasks.push({
    id: "log-task-20260328-app-secret",
    appId: "app_a",
    userId: sessionWithStorage.userId,
    keyId: appSecret.keyId,
    status: "PENDING",
    createdAt: "2026-03-28T09:00:00+08:00",
  });

  const pullResponse = await runtimeWithStorage.app.handle({
    method: "GET",
    path: "/api/v1/logs/pull-task",
    headers: {
      authorization: `Bearer ${sessionWithStorage.accessToken}`,
      "x-app-id": "app_a",
      "x-did": "did_a",
    },
  });
  assert.equal(pullResponse.statusCode, 200);
  assert.equal(pullResponse.body.data.shouldUpload, true);
  if (!pullResponse.body.data.shouldUpload) {
    throw new Error("Expected log upload task.");
  }

  const payload = encryptNdjson(
    [{ tsMs: 1710000000100, level: "info", message: "app secret path" }],
    key,
  );
  const response = await runtimeWithStorage.app.handle({
    method: "POST",
    path: "/api/v1/logs/upload",
    headers: {
      authorization: `Bearer ${sessionWithStorage.accessToken}`,
      "x-app-id": "app_a",
      "x-did": "did_a",
      "x-log-claim-token": pullResponse.body.data.claimToken,
      "x-log-enc": "aes-256-gcm",
      "x-log-key-id": appSecret.keyId,
      "x-log-nonce": payload.nonceBase64,
      "x-log-content": "ndjson+gzip",
      "x-log-task-id": "log-task-20260328-app-secret",
    },
    body: payload.body,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data, {
    taskId: "log-task-20260328-app-secret",
    acceptedCount: 1,
    rejectedCount: 0,
  });
  assert.ok(runtimeWithStorage.database.clientLogUploadTasks[0]?.uploadedFilePath?.includes(storageDir));
});

test("logs upload decrypts claimed AES-GCM+gzip NDJSON payload and stores accepted lines", async () => {
  const key = encodeKeyBase64();
  const storageDir = createTempStorageDir();
  const runtime = await createApplication({
    logEncryptionKeys: {
      "dev-k1": key.base64,
    },
    fileStorageRoot: storageDir,
  });
  const session = await issueAccessToken(runtime);
  await enableLogPull(runtime);

  runtime.database.clientLogUploadTasks.push({
    id: "log-task-20260328-001",
    appId: "app_a",
    userId: session.userId,
    keyId: "dev-k1",
    fromTsMs: 1710000000000,
    toTsMs: 1710003600000,
    maxLines: 2,
    maxBytes: 4096,
    status: "PENDING",
    createdAt: "2026-03-28T10:00:00+08:00",
  });

  const pullResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/logs/pull-task",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
      "x-did": "did_alpha",
    },
  });

  assert.equal(pullResponse.statusCode, 200);
  assert.equal(pullResponse.body.data.shouldUpload, true);
  if (!pullResponse.body.data.shouldUpload) {
    throw new Error("Expected log upload task.");
  }
  assert.equal(pullResponse.body.data.taskId, "log-task-20260328-001");
  assert.equal(pullResponse.body.data.keyId, "dev-k1");

  const lines = [
    {
      tsMs: 1710000000100,
      level: "info",
      message: "app started",
      tag: "boot",
    },
    {
      tsMs: 1710001200000,
      level: "warn",
      message: "cache warm slow",
      tag: "perf",
    },
    {
      tsMs: 1710007200000,
      level: "error",
      message: "outside task window",
      tag: "window",
    },
  ];

  const payload = encryptNdjson(lines, key.raw);
  const uploadResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/logs/upload",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
      "x-did": "did_alpha",
      "x-log-claim-token": pullResponse.body.data.claimToken,
      "x-log-enc": "aes-256-gcm",
      "x-log-key-id": "dev-k1",
      "x-log-nonce": payload.nonceBase64,
      "x-log-content": "ndjson+gzip",
      "x-log-task-id": "log-task-20260328-001",
      "x-log-line-count": String(payload.lineCount),
      "x-log-plain-bytes": String(payload.plainBytes),
      "x-log-compressed-bytes": String(payload.compressedBytes),
    },
    body: payload.body,
  });

  assert.equal(uploadResponse.statusCode, 200);
  assert.deepEqual(uploadResponse.body.data, {
    taskId: "log-task-20260328-001",
    acceptedCount: 2,
    rejectedCount: 1,
  });

  assert.equal(runtime.database.clientLogUploadTasks[0]?.status, "COMPLETED");
  assert.equal(runtime.database.clientLogUploadTasks[0]?.uploadedAt !== undefined, true);
  assert.equal(runtime.database.clientLogUploadTasks[0]?.uploadedFileName, "log-task-20260328-001.ndjson");
  assert.equal(runtime.database.clientLogUploadTasks[0]?.uploadedLineCount, 3);
  assert.ok(runtime.database.clientLogUploadTasks[0]?.uploadedFilePath);
  const savedContent = readFileSync(
    runtime.database.clientLogUploadTasks[0]?.uploadedFilePath as string,
    "utf8",
  );
  assert.match(savedContent, /app started/);
  assert.match(savedContent, /cache warm slow/);
});

test("logs ack(no_data) completes a claimed task without creating uploads", async () => {
  const key = encodeKeyBase64();
  const storageDir = createTempStorageDir();
  const runtime = await createApplication({
    logEncryptionKeys: {
      "dev-k1": key.base64,
    },
    fileStorageRoot: storageDir,
  });
  const session = await issueAccessToken(runtime);
  await enableLogPull(runtime);

  runtime.database.clientLogUploadTasks.push({
    id: "log-task-no-data-001",
    appId: "app_a",
    userId: session.userId,
    keyId: "dev-k1",
    status: "PENDING",
    createdAt: "2026-04-05T12:00:00.000Z",
  });

  const pullResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/logs/pull-task",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
      "x-did": "did_alpha",
    },
  });

  assert.equal(pullResponse.statusCode, 200);
  assert.equal(pullResponse.body.data.shouldUpload, true);
  if (!pullResponse.body.data.shouldUpload) {
    throw new Error("Expected claimed task.");
  }

  const ackResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/logs/tasks/log-task-no-data-001/ack",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
      "x-did": "did_alpha",
    },
    body: {
      claimToken: pullResponse.body.data.claimToken,
      status: "no_data",
    },
  });

  assert.equal(ackResponse.statusCode, 200);
  assert.deepEqual(ackResponse.body.data, {
    taskId: "log-task-no-data-001",
    status: "no_data",
  });
  assert.equal(runtime.database.clientLogUploadTasks[0]?.status, "COMPLETED");
  assert.equal(runtime.database.clientLogUploadTasks[0]?.uploadedFilePath, undefined);
});

test("logs upload rejects claim mismatch, expired claims, and decrypt failure", async () => {
  const key = encodeKeyBase64();
  const storageDir = createTempStorageDir();
  const runtime = await createApplication({
    logEncryptionKeys: {
      "dev-k1": key.base64,
    },
    fileStorageRoot: storageDir,
  });
  const session = await issueAccessToken(runtime);
  runtime.database.clientLogUploadTasks.push({
    id: "log-task-claim-mismatch",
    appId: "app_a",
    userId: session.userId,
    did: "did_alpha",
    keyId: "dev-k1",
    status: "CLAIMED",
    claimToken: "claim_alpha",
    claimExpireAt: "2026-04-05T12:05:00.000Z",
    createdAt: "2026-04-05T11:55:00.000Z",
  });

  const mismatchPayload = encryptNdjson(
    [{ tsMs: 1710000000100, level: "info", message: "task mismatch" }],
    key.raw,
  );
  const mismatchResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/logs/upload",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
      "x-did": "did_alpha",
      "x-log-claim-token": "wrong_claim",
      "x-log-enc": "aes-256-gcm",
      "x-log-key-id": "dev-k1",
      "x-log-nonce": mismatchPayload.nonceBase64,
      "x-log-content": "ndjson+gzip",
      "x-log-task-id": "log-task-claim-mismatch",
    },
    body: mismatchPayload.body,
  });

  assert.equal(mismatchResponse.statusCode, 409);
  assert.equal(mismatchResponse.body.code, "LOG_CLAIM_MISMATCH");

  runtime.database.clientLogUploadTasks.push({
    id: "log-task-claim-expired",
    appId: "app_a",
    userId: session.userId,
    did: "did_alpha",
    keyId: "dev-k1",
    status: "CLAIMED",
    claimToken: "claim_expired",
    claimExpireAt: "2000-01-01T00:00:00.000Z",
    createdAt: "2026-04-05T11:54:00.000Z",
  });

  const expiredPayload = encryptNdjson(
    [{ tsMs: 1710000000100, level: "info", message: "expired claim" }],
    key.raw,
  );
  const expiredResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/logs/upload",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
      "x-did": "did_alpha",
      "x-log-claim-token": "claim_expired",
      "x-log-enc": "aes-256-gcm",
      "x-log-key-id": "dev-k1",
      "x-log-nonce": expiredPayload.nonceBase64,
      "x-log-content": "ndjson+gzip",
      "x-log-task-id": "log-task-claim-expired",
    },
    body: expiredPayload.body,
    requestId: "req_expired",
  });

  assert.equal(expiredResponse.statusCode, 409);
  assert.equal(expiredResponse.body.code, "LOG_CLAIM_EXPIRED");

  runtime.database.clientLogUploadTasks.push({
    id: "log-task-completed",
    appId: "app_a",
    userId: session.userId,
    did: "did_alpha",
    keyId: "dev-k1",
    status: "COMPLETED",
    claimToken: "claim_done",
    claimExpireAt: "2026-04-05T12:05:00.000Z",
    createdAt: "2026-04-05T11:53:00.000Z",
  });

  const completedPayload = encryptNdjson(
    [{ tsMs: 1710000000100, level: "info", message: "completed task" }],
    key.raw,
  );
  const completedResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/logs/upload",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
      "x-did": "did_alpha",
      "x-log-claim-token": "claim_done",
      "x-log-enc": "aes-256-gcm",
      "x-log-key-id": "dev-k1",
      "x-log-nonce": completedPayload.nonceBase64,
      "x-log-content": "ndjson+gzip",
      "x-log-task-id": "log-task-completed",
    },
    body: completedPayload.body,
  });

  assert.equal(completedResponse.statusCode, 409);
  assert.equal(completedResponse.body.code, "LOG_TASK_ALREADY_COMPLETED");

  runtime.database.clientLogUploadTasks.push({
    id: "log-task-decrypt-fail",
    appId: "app_a",
    userId: session.userId,
    did: "did_alpha",
    keyId: "dev-k1",
    status: "CLAIMED",
    claimToken: "claim_ok",
    claimExpireAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-04-05T11:56:00.000Z",
  });

  const decryptPayload = encryptNdjson(
    [{ tsMs: 1710000000100, level: "info", message: "decrypt fail" }],
    key.raw,
  );
  const decryptFailureResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/logs/upload",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
      "x-did": "did_alpha",
      "x-log-claim-token": "claim_ok",
      "x-log-enc": "aes-256-gcm",
      "x-log-key-id": "dev-k1",
      "x-log-nonce": randomBytes(12).toString("base64"),
      "x-log-content": "ndjson+gzip",
      "x-log-task-id": "log-task-decrypt-fail",
    },
    body: decryptPayload.body,
  });

  assert.equal(decryptFailureResponse.statusCode, 400);
  assert.equal(decryptFailureResponse.body.code, "LOG_DECRYPT_FAILED");
  assert.equal(runtime.database.clientLogUploadTasks.every((item) => !item.uploadedFilePath), true);
});

test("logs fail marks a claimed task as FAILED and stores failure reason", async () => {
  const runtime = await createApplication();
  const session = await issueAccessToken(runtime);
  runtime.database.clientLogUploadTasks.push({
    id: "log-task-fail-001",
    appId: "app_a",
    userId: session.userId,
    did: "did_alpha",
    keyId: "dev-k1",
    status: "CLAIMED",
    claimToken: "claim_fail",
    claimExpireAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-04-05T11:57:00.000Z",
  });

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/logs/tasks/log-task-fail-001/fail",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
      "x-did": "did_alpha",
    },
    body: {
      claimToken: "claim_fail",
      reason: "upload_failed",
      message: "network timeout after 5 retries",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.taskId, "log-task-fail-001");
  assert.equal(response.body.data.status, "failed");
  assert.match(String(response.body.data.failureReason), /upload_failed/);
  assert.equal(runtime.database.clientLogUploadTasks[0]?.status, "FAILED");
  assert.equal(runtime.database.clientLogUploadTasks[0]?.claimToken, undefined);
  assert.equal(runtime.database.clientLogUploadTasks[0]?.claimExpireAt, undefined);
  assert.match(String(runtime.database.clientLogUploadTasks[0]?.failureReason), /network timeout/);
});
