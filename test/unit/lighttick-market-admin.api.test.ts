import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
test("market credentials require admin session and sensitive grant; CAS/replay, config history and audits exclude tokens", async () => {
  const app = await createApplication({
      seed: buildDefaultSeed(undefined, { includeLightTick: true }),
      lighttickEnabled: true,
      adminBasicAuth: {
        username: "market-admin",
        password: "synthetic-password",
      },
    }),
    base = "/api/v1/admin/apps/lighttick/market-providers/tushare-credential";
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    cookie?: string,
    key = "market-admin-original",
  ) =>
    app.app.handle({
      path,
      method,
      body,
      headers: { "idempotency-key": key },
      cookies: cookie ? { adminSession: cookie } : {},
      requestId: "synthetic-market-admin",
    });
  assert.equal((await call(base)).statusCode, 401);
  const login = await call("/api/v1/admin/auth/login", "POST", {
    username: "market-admin",
    password: "synthetic-password",
  });
  assert.equal(login.statusCode, 200);
  const cookie = decodeURIComponent(
    login.headers!["Set-Cookie"].match(/adminSession=([^;]+)/)![1],
  );
  const body = { base_revision: 0, token: "SYNTHETIC_ONLY_TOKEN_NEVER_REAL" };
  assert.equal((await call(base, "PUT", body, cookie)).statusCode, 403);
  const operation = "lighttick.market.credentials.write";
  assert.equal(
    (
      await call(
        "/api/v1/admin/sensitive-operations/request-code",
        "POST",
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
        "POST",
        { operation, code: "199510" },
        cookie,
      )
    ).statusCode,
    200,
  );
  const r = await call(base, "PUT", body, cookie);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal((r.body as any).data.revision, 1);
  assert.deepEqual((await call(base, "PUT", body, cookie)).body, r.body);
  assert.equal(
    (
      await call(
        base,
        "PUT",
        { ...body, token: "DIFFERENT_SYNTHETIC_TOKEN" },
        cookie,
      )
    ).statusCode,
    409,
  );
  const summary = await call(base, "GET", undefined, cookie);
  assert.equal((summary.body as any).data.configured, true);
  assert.ok(!JSON.stringify(summary).includes(body.token));
  const rawJson = JSON.stringify({
    app: "lighttick",
    investment_market: {
      providers: {
        csv: { enabled: true },
        tushare: { enabled: true },
        eastmoney: { enabled: false },
        tencent: { enabled: false },
      },
    },
  });
  const config = await call(
    "/api/v1/admin/apps/lighttick/config",
    "PUT",
    { rawJson },
    cookie,
    "market-admin-settings",
  );
  assert.equal(config.statusCode, 200, JSON.stringify(config.body));
  const policy =
    await app.services.lighttickRuntime!.marketPolicy!.policy("tushare");
  assert.equal(policy.enabled, true);
  assert.equal(policy.tushare_token, body.token);
  const invalid = await call(
    "/api/v1/admin/apps/lighttick/config",
    "PUT",
    {
      rawJson: JSON.stringify({
        investment_market: {
          providers: { tushare: { enabled: true, token: body.token } },
        },
      }),
    },
    cookie,
    "market-admin-invalid-settings",
  );
  assert.equal(invalid.statusCode, 422);
  assert.ok(
    !JSON.stringify(
      (
        await call(
          "/api/v1/admin/apps/lighttick/config",
          "GET",
          undefined,
          cookie,
        )
      ).body,
    ).includes(body.token),
  );
  const removed = await call(
    base,
    "PUT",
    { base_revision: 1, token: null },
    cookie,
    "market-admin-remove",
  );
  assert.equal(removed.statusCode, 200);
  assert.equal((removed.body as any).data.configured, false);
  assert.equal(
    (await app.services.lighttickRuntime!.marketPolicy!.policy("tushare"))
      .tushare_token,
    undefined,
  );
  const audit = app.database.auditLogs.filter((r) =>
    r.action.startsWith("lighttick.market."),
  );
  assert.ok(audit.length > 0);
  assert.ok(!JSON.stringify(audit).includes(body.token));
});
