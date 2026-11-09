import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

const root = "/api/v1/admin/apps/ai_novel/credit-grants";
test("admin credit grants search, grant, retry, records and environment isolation", async () => {
  const runtime = await createApplication({ adminBasicAuth: { username: "admin", password: "AdminPass123!" } });
  for (let i = 0; i < 11; i++) runtime.database.users.push({ id: `user_${i}`, phone: `555000${i}`, email: `person${i}@example.com`, passwordHash: "x", passwordAlgo: "x", status: "ACTIVE", createdAt: new Date().toISOString() });
  const call = (method: string, path: string, headers: Record<string, string>, body?: unknown, query?: Record<string, string>) => runtime.app.handle({ method, path, headers, body, query });
  assert.equal((await call("GET", `${root}/users`, {}, undefined, { field: "uid", query: "user" })).statusCode, 401);
  const login = await call("POST", "/api/v1/admin/auth/login", {}, { username: "admin", password: "AdminPass123!" });
  const headers = { cookie: login.headers!["Set-Cookie"]! };
  let response = await call("GET", `${root}/users`, headers, undefined, { field: "uid", query: "user_" });
  assert.equal(response.statusCode, 200); assert.deepEqual(response.body.data, { tooMany: true, users: [] });
  for (const [field, query] of [["uid", "user_1"], ["phone", "5550001"], ["email", "person1@"]]) {
    response = await call("GET", `${root}/users`, headers, undefined, { field, query });
    assert.equal(response.statusCode, 200); assert.ok(response.body.data.users.some((u: {uid:string}) => u.uid === "user_1"));
  }
  const command = { uid: "user_1", points: 12, idempotencyKey: "grant-123" };
  assert.equal((await call("POST", root, {}, command)).statusCode, 401);
  assert.equal((await call("POST", root, headers, { ...command, uid: "absent" })).statusCode, 400);
  assert.equal((await call("POST", root, headers, { ...command, points: 0 })).statusCode, 400);
  const concurrent = await Promise.all([call("POST", root, headers, command), call("POST", root, headers, command)]);
  assert.deepEqual(concurrent.map(r => r.statusCode), [200, 200]);
  assert.equal((await call("POST", root, headers, { ...command, points: 13 })).statusCode, 409);
  assert.equal((await call("POST", root, headers, { ...command, uid: "user_2" })).statusCode, 409);
  response = await call("GET", root, headers);
  assert.equal(response.statusCode, 200); assert.equal(response.body.data.items.length, 1);
  assert.equal(response.body.data.items[0].uid, "user_1"); assert.equal(response.body.data.items[0].points, 12); assert.equal(response.body.data.items[0].adminUser, "admin");
  assert.equal(response.body.data.items[0].phone, "5550001"); assert.equal(response.body.data.items[0].email, "person1@example.com"); assert.equal(response.body.data.items[0].contactSource, "snapshot");
  const changedUser = runtime.database.users.find(user => user.id === "user_1")!;
  changedUser.phone = "changed-phone"; changedUser.email = "changed@example.com";
  assert.equal((await call("POST", root, headers, command)).statusCode, 200);
  response = await call("GET", root, headers);
  assert.equal(response.body.data.items[0].phone, "5550001"); assert.equal(response.body.data.items[0].email, "person1@example.com");
  const account = await runtime.database.aiNovelCreditsStore.transact("user_1", "", state => structuredClone(state.account));
  assert.equal(account?.giftMicros, "12000000"); assert.equal(account?.deferredStart, true);
  const sandboxHeaders = { ...headers, "x-billing-environment": "sandbox" };
  assert.equal((await call("GET", root, sandboxHeaders)).body.data.items.length, 0);
  assert.equal((await call("POST", root, sandboxHeaders, command)).statusCode, 200);
  assert.equal((await call("GET", root, sandboxHeaders)).body.data.items.length, 1);
  assert.equal((await call("GET", root, headers)).body.data.items.length, 1);
});
