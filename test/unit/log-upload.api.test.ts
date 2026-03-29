import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createApplication } from "../../src/app.module.ts";

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

test("logs pull-task returns shouldUpload false when no pending task exists", async () => {
  const runtime = await createApplication();
  const session = await issueAccessToken(runtime);

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/logs/pull-task",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data, {
    shouldUpload: false,
  });
});

test("logs upload can decrypt payloads using app-generated log secrets", async () => {
  const runtime = await createApplication();
  const session = await issueAccessToken(runtime);
  const appSecret = runtime.services.appLogSecretService.ensureSecret("app_a").record;
  const key = Buffer.from(appSecret.secret, "base64");

  runtime.database.clientLogUploadTasks.push({
    id: "log-task-20260328-app-secret",
    appId: "app_a",
    userId: session.userId,
    keyId: appSecret.keyId,
    status: "PENDING",
    createdAt: "2026-03-28T09:00:00+08:00",
  });

  const payload = encryptNdjson(
    [{ tsMs: 1710000000100, level: "info", message: "app secret path" }],
    key,
  );
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/logs/upload",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-app-id": "app_a",
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
});

test("logs upload decrypts AES-GCM+gzip NDJSON payload and stores accepted lines", async () => {
  const key = encodeKeyBase64();
  const runtime = await createApplication({
    logEncryptionKeys: {
      "dev-k1": key.base64,
    },
  });
  const session = await issueAccessToken(runtime);

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

  assert.equal(runtime.database.clientLogUploads.length, 1);
  assert.equal(runtime.database.clientLogLines.length, 2);
  assert.equal(runtime.database.clientLogUploadTasks[0]?.status, "COMPLETED");
  assert.equal(runtime.database.clientLogUploadTasks[0]?.uploadedAt !== undefined, true);
  assert.equal(runtime.database.clientLogLines[0]?.message, "app started");
  assert.equal(runtime.database.clientLogLines[1]?.level, "warn");
});

test("logs upload rejects task mismatch and decrypt failure", async () => {
  const key = encodeKeyBase64();
  const runtime = await createApplication({
    logEncryptionKeys: {
      "dev-k1": key.base64,
    },
  });
  const session = await issueAccessToken(runtime);

  runtime.database.clientLogUploadTasks.push({
    id: "log-task-20260328-002",
    appId: "app_a",
    userId: session.userId,
    keyId: "dev-k1",
    status: "PENDING",
    createdAt: "2026-03-28T10:10:00+08:00",
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
      "x-log-enc": "aes-256-gcm",
      "x-log-key-id": "dev-k1",
      "x-log-nonce": mismatchPayload.nonceBase64,
      "x-log-content": "ndjson+gzip",
      "x-log-task-id": "another-task-id",
    },
    body: mismatchPayload.body,
  });

  assert.equal(mismatchResponse.statusCode, 400);
  assert.equal(mismatchResponse.body.code, "LOG_TASK_MISMATCH");

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
      "x-log-enc": "aes-256-gcm",
      "x-log-key-id": "dev-k1",
      "x-log-nonce": randomBytes(12).toString("base64"),
      "x-log-content": "ndjson+gzip",
      "x-log-task-id": "log-task-20260328-002",
    },
    body: decryptPayload.body,
  });

  assert.equal(decryptFailureResponse.statusCode, 400);
  assert.equal(decryptFailureResponse.body.code, "LOG_DECRYPT_FAILED");
  assert.equal(runtime.database.clientLogUploads.length, 0);
  assert.equal(runtime.database.clientLogLines.length, 0);
});
