import assert from "node:assert/strict";
import test from "node:test";
import { TokenService } from "../../src/modules/auth/token.service.ts";
import { encodeBase64Url, signValue } from "../../src/shared/utils.ts";

// --- Token issuance ---

test("TokenService issues a well-formed access token", () => {
  const service = new TokenService("test-secret");
  const now = new Date("2026-04-13T10:00:00+08:00");
  const token = service.issueAccessToken("user_1", "app_1", 1, now);

  const parts = token.split(".");
  assert.equal(parts.length, 2);

  const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  assert.equal(payload.sub, "user_1");
  assert.equal(payload.app_id, "app_1");
  assert.equal(payload.type, "access");
  assert.equal(payload.ver, 1);
  assert.ok(payload.jti.startsWith("atk_"));
  assert.equal(payload.iat, Math.floor(now.getTime() / 1000));
});

test("TokenService defaults tokenVersion to 1", () => {
  const service = new TokenService("test-secret");
  const now = new Date("2026-04-13T10:00:00+08:00");
  const token = service.issueAccessToken("user_1", "app_1", undefined, now);

  const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
  assert.equal(payload.ver, 1);
});

test("TokenService expiresInSeconds defaults to 900", () => {
  const service = new TokenService("test-secret");
  assert.equal(service.expiresInSeconds, 900);
});

test("TokenService allows custom accessTokenTtlSeconds", () => {
  const service = new TokenService("test-secret", { accessTokenTtlSeconds: 60 });
  assert.equal(service.expiresInSeconds, 60);
});

// --- Token verification ---

test("TokenService verifies a valid token within its TTL", () => {
  const service = new TokenService("test-secret");
  const now = new Date("2026-04-13T10:00:00+08:00");
  const token = service.issueAccessToken("user_1", "app_1", 2, now);

  const ctx = service.verifyAccessToken(token, now);
  assert.equal(ctx.userId, "user_1");
  assert.equal(ctx.appId, "app_1");
  assert.equal(ctx.tokenVersion, 2);
  assert.ok(ctx.tokenId.startsWith("atk_"));
});

test("TokenService rejects an expired token", () => {
  const service = new TokenService("test-secret");
  const issuedAt = new Date("2026-04-13T10:00:00+08:00");
  const token = service.issueAccessToken("user_1", "app_1", 1, issuedAt);

  const later = new Date(issuedAt.getTime() + 20 * 60 * 1000); // 20 min later
  assert.throws(
    () => service.verifyAccessToken(token, later),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_INVALID_TOKEN",
  );
});

test("TokenService rejects a token with wrong signature", () => {
  const service = new TokenService("test-secret");
  const now = new Date("2026-04-13T10:00:00+08:00");
  const token = service.issueAccessToken("user_1", "app_1", 1, now);

  // Tamper the signature
  const parts = token.split(".");
  const tampered = `${parts[0]}.invalid-signature`;

  assert.throws(
    () => service.verifyAccessToken(tampered, now),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_INVALID_TOKEN",
  );
});

test("TokenService rejects a tampered payload", () => {
  const service = new TokenService("test-secret");
  const now = new Date("2026-04-13T10:00:00+08:00");
  const token = service.issueAccessToken("user_1", "app_1", 1, now);

  const parts = token.split(".");
  const tamperedPayload = encodeBase64Url(JSON.stringify({
    sub: "user_hacker",
    app_id: "app_1",
    type: "access",
    jti: "atk_xxx",
    ver: 1,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + 900,
  }));
  // Keep the old signature
  const tampered = `${tamperedPayload}.${parts[1]}`;

  assert.throws(
    () => service.verifyAccessToken(tampered, now),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_INVALID_TOKEN",
  );
});

test("TokenService rejects a token missing the signature part", () => {
  const service = new TokenService("test-secret");
  const now = new Date("2026-04-13T10:00:00+08:00");
  const token = service.issueAccessToken("user_1", "app_1", 1, now);
  const parts = token.split(".");

  assert.throws(
    () => service.verifyAccessToken(parts[0], now),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_INVALID_TOKEN",
  );
});

test("TokenService rejects a token with empty signature", () => {
  const service = new TokenService("test-secret");
  const now = new Date("2026-04-13T10:00:00+08:00");
  const token = service.issueAccessToken("user_1", "app_1", 1, now);
  const parts = token.split(".");

  assert.throws(
    () => service.verifyAccessToken(`${parts[0]}.`, now),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_INVALID_TOKEN",
  );
});

test("TokenService rejects a non-access token type", () => {
  const service = new TokenService("test-secret");
  const now = new Date("2026-04-13T10:00:00+08:00");
  const payload = {
    sub: "user_1",
    app_id: "app_1",
    type: "refresh", // wrong type
    jti: "atk_xxx",
    ver: 1,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + 900,
  };
  const serializedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signValue("test-secret", serializedPayload);

  assert.throws(
    () => service.verifyAccessToken(`${serializedPayload}.${signature}`, now),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_INVALID_TOKEN",
  );
});

// --- Key rotation ---

test("TokenService verifies tokens signed with a previous secret during rotation", () => {
  const service = new TokenService("new-secret", { previousSecrets: ["old-secret"] });
  const now = new Date("2026-04-13T10:00:00+08:00");

  // Simulate a token signed with the old secret
  const payload = {
    sub: "user_1",
    app_id: "app_1",
    type: "access",
    jti: "atk_xxx",
    ver: 1,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + 900,
  };
  const serializedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signValue("old-secret", serializedPayload);

  const ctx = service.verifyAccessToken(`${serializedPayload}.${signature}`, now);
  assert.equal(ctx.userId, "user_1");
  assert.equal(ctx.appId, "app_1");
});

test("TokenService issues new tokens with the current secret only", () => {
  const service = new TokenService("new-secret", { previousSecrets: ["old-secret"] });
  const now = new Date("2026-04-13T10:00:00+08:00");
  const token = service.issueAccessToken("user_1", "app_1", 1, now);

  // The new token should NOT verify with the old secret
  const parts = token.split(".");
  const oldSignature = signValue("old-secret", parts[0]);
  assert.notEqual(parts[1], oldSignature);
});

test("TokenService filters out empty or duplicate previous secrets", () => {
  const service = new TokenService("secret", { previousSecrets: ["", "secret", "old"] });
  const now = new Date("2026-04-13T10:00:00+08:00");
  const token = service.issueAccessToken("user_1", "app_1", 1, now);

  const ctx = service.verifyAccessToken(token, now);
  assert.equal(ctx.userId, "user_1");
});

// --- Token version ---

test("TokenService rejects token with ver <= 0", () => {
  const service = new TokenService("test-secret");
  const now = new Date("2026-04-13T10:00:00+08:00");
  const payload = {
    sub: "user_1",
    app_id: "app_1",
    type: "access",
    jti: "atk_xxx",
    ver: 0,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + 900,
  };
  const serializedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signValue("test-secret", serializedPayload);

  assert.throws(
    () => service.verifyAccessToken(`${serializedPayload}.${signature}`, now),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_INVALID_TOKEN",
  );
});

test("TokenService verifies at the exact expiry boundary", () => {
  const service = new TokenService("test-secret");
  const issuedAt = new Date("2026-04-13T10:00:00+08:00");
  const token = service.issueAccessToken("user_1", "app_1", 1, issuedAt);
  const expiryTime = new Date(issuedAt.getTime() + 900 * 1000);

  // At exactly the expiry second, the token should still be rejected (exp <= now)
  assert.throws(
    () => service.verifyAccessToken(token, expiryTime),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_INVALID_TOKEN",
  );

  // One second before expiry, should still pass
  const justBefore = new Date(expiryTime.getTime() - 1000);
  const ctx = service.verifyAccessToken(token, justBefore);
  assert.equal(ctx.userId, "user_1");
});
