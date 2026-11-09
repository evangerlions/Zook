import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { learningMigrationFixture } from "../support/native-learning-migration-fixture.ts";
test("learning migration requires an existing admin session and sensitive grant, reauthorizes replay and audits metadata only", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "native-migration-member",
    appId: "lighttick",
    userId: "user_alice",
    status: "ACTIVE",
    accountRegion: "UNKNOWN",
    joinedAt: new Date().toISOString(),
  });
  const app = await createApplication({
    seed,
    lighttickEnabled: true,
    adminBasicAuth: {
      username: "migration-admin",
      password: "synthetic-password",
    },
  });
  const runtime = app.services.lighttickRuntime!;
  runtime.nativeLearning = new NativeLearningService(runtime.repository, true);
  const f = learningMigrationFixture("user_alice"),
    base = "/api/v1/admin/apps/lighttick/learning-migrations/user_alice/";
  const body = {
    bundle: f.bundle,
    expected_digest: f.digest,
    base_revision: 0,
  };
  const call = (
    path: string,
    data: unknown,
    cookie?: string,
    headers: Record<string, string> = {},
  ) =>
    app.app.handle({
      method: "POST",
      path,
      body: data,
      headers,
      cookies: cookie ? { adminSession: cookie } : {},
      requestId: "synthetic-admin-learning",
    });
  assert.equal((await call(base + "preflight", body)).statusCode, 401);
  const bearer = app.services.tokenService.issueAccessToken(
    "user_alice",
    "lighttick",
  );
  assert.equal(
    (
      await call(base + "freeze", body, undefined, {
        authorization: "Bearer " + bearer,
      })
    ).statusCode,
    401,
  );
  const login = await call("/api/v1/admin/auth/login", {
    username: "migration-admin",
    password: "synthetic-password",
  });
  assert.equal(login.statusCode, 200);
  const cookie = decodeURIComponent(
    login.headers!["Set-Cookie"].match(/adminSession=([^;]+)/)![1],
  );
  const preflight = await call(base + "preflight", body, cookie);
  assert.equal(preflight.statusCode, 200, JSON.stringify(preflight.body));
  assert.equal(
    await runtime.repository.getLearningAuthority({
      appId: "lighttick",
      userId: "user_alice",
    }),
    undefined,
  );
  assert.equal(
    (
      await call(base + "freeze", body, cookie, {
        "idempotency-key": "admin-freeze-key",
      })
    ).statusCode,
    403,
  );
  const operation = "lighttick.learning.migrate";
  assert.equal(
    (
      await call(
        "/api/v1/admin/sensitive-operations/request-code",
        { operation },
        cookie,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "/api/v1/admin/sensitive-operations/verify",
        { operation, code: "199510" },
        cookie,
      )
    ).statusCode,
    200,
  );
  const frozen = await call(base + "freeze", body, cookie, {
    "idempotency-key": "admin-freeze-key",
  });
  assert.equal(frozen.statusCode, 200, JSON.stringify(frozen.body));
  assert.equal(
    (
      await call(base + "freeze", body, cookie, {
        "idempotency-key": "admin-freeze-key",
      })
    ).statusCode,
    200,
  );
  const audit = app.database.auditLogs.filter((r) =>
    r.action.startsWith("lighttick.learning.migration."),
  );
  assert.ok(audit.length >= 2);
  const serialized = JSON.stringify(audit);
  assert.ok(!serialized.includes("Queued phone note"));
  assert.ok(!serialized.includes("Original earlier lesson"));
  assert.ok(!serialized.includes("legacy-source-alice"));
  await app.database.updateAppUserStatus("lighttick", "user_alice", "BLOCKED");
  assert.equal(
    (
      await call(base + "freeze", body, cookie, {
        "idempotency-key": "admin-freeze-key",
      })
    ).statusCode,
    403,
  );
});
