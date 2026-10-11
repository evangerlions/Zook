import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

test("usage API requires Admin session, validates queries, exposes only real empty evidence and audits reads", async () => {
  const runtime = await createApplication({
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
  });
  const path = "/api/v1/admin/apps/ai_novel/usage";
  assert.equal(
    (await runtime.app.handle({ method: "GET", path, headers: {} })).statusCode,
    401,
  );
  assert.equal(
    (
      await runtime.app.handle({
        method: "GET",
        path,
        headers: {
          authorization: `Basic ${Buffer.from("admin:AdminPass123!").toString("base64")}`,
        },
      })
    ).statusCode,
    401,
  );
  const login = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/auth/login",
    headers: {},
    body: { username: "admin", password: "AdminPass123!" },
  });
  const headers = { cookie: login.headers!["Set-Cookie"]! };
  assert.equal(
    (
      await runtime.app.handle({
        method: "GET",
        path,
        headers,
        query: { days: "1000" },
      })
    ).statusCode,
    400,
  );
  const response = await runtime.app.handle({
    method: "GET",
    path,
    headers,
    query: { days: "30", tier: "all" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.["Cache-Control"], "no-store");
  assert.equal(response.body.data.summary.chargedPoints, 0);
  assert.equal(response.body.data.tiers[0].p95, null);
  assert.equal(response.body.data.reportingSince, null);
  assert.notEqual(
    (await runtime.app.handle({ method: "POST", path, headers })).statusCode,
    200,
  );
});
