import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { randomInt } from "node:crypto";
import { createApplication } from "../../src/app.module.ts";
import { readRequestBody } from "../../src/infrastructure/http/request-body.ts";
import { KVManager } from "../../src/infrastructure/kv/kv-manager.ts";

const connectionString = process.env.YAOHEZI_TEST_DATABASE_URL;
if (!connectionString) throw new Error("YAOHEZI_TEST_DATABASE_URL must reference an isolated local PostgreSQL database.");
const address = new URL(connectionString);
if (!["localhost", "127.0.0.1"].includes(address.hostname) || !address.pathname.startsWith("/yaohezi_local_")) {
  throw new Error("This local verification only accepts localhost/yaohezi_local_* databases.");
}
const redisUrl = process.env.YAOHEZI_TEST_REDIS_URL;
if (!redisUrl || new URL(redisUrl).hostname !== "127.0.0.1" || !new URL(redisUrl).password) {
  throw new Error("Use verify:yaohezi-local to start an isolated, password-protected loopback Redis instance.");
}

test("real PostgreSQL and local HTTP: SMS account, scoped me, refresh race, logout and membership reopen", async (t) => {
  const sent: Array<{ phoneNumber: string; code: string; expireMinutes: number }> = [];
  const kvManager = await KVManager.create({ redisUrl });
  await kvManager.assertReady();
  t.after(async () => { await kvManager.disconnect(); });
  const options = { databaseUrl: connectionString, migrationDatabaseUrl: connectionString, yaoheziEnabled: true,
    frogsleepEnabled: false, lighttickEnabled: false, kvManager, queueBackend: "memory" as const,
    registrationCodeGenerator: () => "491827", accessTokenSecret: "local-yaohezi-fixture-secret-20261030",
    smsVerificationSender: { async sendVerificationCode(command: { phoneNumber: string; code: string; expireMinutes: number }) {
      sent.push(command); return { provider: "tencent_sms" as const, phoneNumber: command.phoneNumber };
    } } };
  const runtime = await createApplication(options);
  t.after(async () => { await runtime.close(); });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const handled = await runtime.app.handle({ method: request.method ?? "GET", path: url.pathname,
        query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(Object.entries(request.headers)
          .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])),
        body: await readRequestBody(request, request.headers["content-type"]), ipAddress: "127.0.0.1", hostname: "localhost" });
      response.writeHead(handled.statusCode, { "content-type": "application/json", ...handled.headers });
      response.end(JSON.stringify(handled.body));
    } catch { response.writeHead(500); response.end("{}"); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  const port = (server.address() as { port: number }).port;
  async function request(path: string, body?: unknown, token?: string) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  const phone = String(15530000000 + randomInt(10000000));
  const base = { appId: "yaohezi", phone, phoneNa: "+86" };
  const issue = await request("/api/v1/auth/login/sms-code", base);
  assert.equal(issue.status, 200);
  assert.equal(sent.length, 1, "The local transport records one server-generated code; no test=true bypass is used");
  const wrong = await request("/api/v1/auth/login/sms", { ...base, smsCode: "000000", clientType: "app" });
  assert.equal(wrong.status, 401);
  const login = await request("/api/v1/auth/login/sms", { ...base, smsCode: sent[0].code, clientType: "app" });
  assert.equal(login.status, 200);
  const session = login.body.data;
  const me = await request("/api/v1/yaohezi/me", undefined, session.accessToken);
  assert.equal(me.status, 200); assert.equal(me.body.data.healthAccessEstablished, false);
  const reopenedKV = await KVManager.create({ redisUrl });
  const reopenedBeforeLogout = await createApplication({ ...options, kvManager: reopenedKV });
  try {
    const continued = await reopenedBeforeLogout.app.handle({ method: "GET", path: "/api/v1/yaohezi/me",
      headers: { authorization: `Bearer ${session.accessToken}` } });
    assert.equal(continued.statusCode, 200, "A fresh application/Redis client accepts the existing session");
  } finally { await reopenedBeforeLogout.close(); await reopenedKV.disconnect(); }
  const others = await request("/api/v1/auth/login", { appId: "app_a", account: "alice@example.com", password: "Password1234", clientType: "app" });
  assert.equal(others.status, 200);
  assert.equal((await request("/api/v1/yaohezi/me", undefined, others.body.data.accessToken)).status, 403);
  const results = await Promise.all([0, 1].map(() => request("/api/v1/auth/refresh", {
    appId: "yaohezi", refreshToken: session.refreshToken, clientType: "app" })));
  assert.deepEqual(results.map((item) => item.status).sort(), [200, 401]);
  const rotated = results.find((item) => item.status === 200)!.body.data;
  const logout = await request("/api/v1/auth/logout", { appId: "yaohezi", scope: "current", refreshToken: rotated.refreshToken }, rotated.accessToken);
  assert.equal(logout.status, 200);
  assert.equal((await request("/api/v1/auth/refresh", { appId: "yaohezi", clientType: "app", refreshToken: rotated.refreshToken })).status, 401);
  const reopened = await createApplication(options);
  try {
    assert.equal((await reopened.database.findAppUser("yaohezi", session.user.id))?.status, "ACTIVE");
    assert.equal((await reopened.database.findAppUser("app_a", "user_alice"))?.status, "ACTIVE");
  } finally { await reopened.close(); }
});
