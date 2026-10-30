import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

async function login(runtime: Awaited<ReturnType<typeof createApplication>>, appId: string) {
  return runtime.app.handle({ method: "POST", path: "/api/v1/auth/login", headers: {},
    body: { appId, account: "alice@example.com", password: "Password1234", clientType: "app" }, ipAddress: "198.51.100.43" });
}

test("Yaohezi is independently disabled by default", async () => {
  const runtime = await createApplication({ yaoheziEnabled: false });
  assert.equal((await runtime.app.handle({ method: "GET", path: "/api/v1/yaohezi/me", headers: {} })).statusCode, 404);
});

test("Yaohezi uses shared identity but does not establish health ownership on login", async () => {
  const runtime = await createApplication({ yaoheziEnabled: true });
  const result = await login(runtime, "yaohezi");
  assert.equal(result.statusCode, 200);
  const me = await runtime.app.handle({ method: "GET", path: "/api/v1/yaohezi/me",
    headers: { authorization: `Bearer ${result.body.data.accessToken}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.body.data.appId, "yaohezi");
  assert.equal(me.body.data.userId, "user_alice");
  assert.equal(me.body.data.healthAccessEstablished, false);
  assert.equal(me.body.data.capabilities.cloudSync, false);
});

test("other-product tokens are rejected before Yaohezi metadata is returned", async () => {
  const runtime = await createApplication({ yaoheziEnabled: true });
  const result = await login(runtime, "app_a");
  const me = await runtime.app.handle({ method: "GET", path: "/api/v1/yaohezi/me",
    headers: { authorization: `Bearer ${result.body.data.accessToken}` } });
  assert.equal(me.statusCode, 403);
  assert.equal(me.body.data, null);
});

test("blocked and deleted Yaohezi memberships deny valid access tokens", async () => {
  for (const status of ["BLOCKED", "DELETED"] as const) {
    const runtime = await createApplication({ yaoheziEnabled: true });
    const result = await login(runtime, "yaohezi");
    await runtime.database.updateAppUserStatus("yaohezi", "user_alice", status);
    const me = await runtime.app.handle({ method: "GET", path: "/api/v1/yaohezi/me",
      headers: { authorization: `Bearer ${result.body.data.accessToken}` } });
    assert.equal(me.statusCode, 403);
    assert.equal(me.body.data, null);
  }
});
