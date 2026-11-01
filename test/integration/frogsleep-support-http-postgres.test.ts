import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { createApplication } from "../../src/app.module.ts";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { BuddySupportCommand } from "../../src/modules/frogsleep/buddy-support/buddy-support-command.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";
enableFrogSleepBuddyCapabilities();
process.env.FROGSLEEP_BUDDY_SUPPORT_ENABLED = "true";
const url = process.env.FROGSLEEP_TEST_DATABASE_URL;
if (!url) throw new Error("Disposable FROGSLEEP_TEST_DATABASE_URL is required.");

async function boot() {
  const runtime = await createApplication({ frogsleepEnabled: true, queueBackend: "memory", kvBackend: new InMemoryKVBackend(),
    databaseFactory: seed => PostgresDatabase.create(url!, seed) });
  const server = createServer(async (request, response) => {
    let data = ""; for await (const chunk of request) data += chunk;
    const target = new URL(request.url!, "http://localhost");
    const result = await runtime.app.handle({ method: request.method, path: target.pathname,
      headers: request.headers, query: Object.fromEntries(target.searchParams),
      body: data ? JSON.parse(data) : undefined, requestId: "support_http" } as never);
    response.writeHead(result.statusCode, { "content-type": "application/json", ...result.headers });
    response.end(JSON.stringify(result.body));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { runtime, origin, close: async () => {
    await new Promise<void>(resolve => server.close(() => resolve())); await runtime.close();
  } };
}
async function call(origin: string, method: string, suffix: string, token?: string, body?: unknown) {
  const response = await fetch(`${origin}/api/v1/frogsleep${suffix}`, { method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); assert.equal(response.status, 200, result.code); return result.data;
}
async function login(origin: string, account: string) {
  return (await call(origin, "POST", "/auth/password/login", undefined, { account, password: "Password1234" })).access_token;
}
async function prepare(runtime: Awaited<ReturnType<typeof createApplication>>) {
  const now = new Date().toISOString(), id = "support_http_sleep";
  await runtime.database.getBuddySupportRepository().deleteUser("frogsleep", "user_alice", [id]);
  if (!await runtime.database.findFrogSleepEntity("sleep_relationship", "frogsleep", id)) {
    await runtime.database.insertFrogSleepEntity({ id, appId: "frogsleep", kind: "sleep_relationship", ownerUserId: "user_alice",
      partnerUserId: "user_bob", status: "accepted", payload: {}, createdAt: now, updatedAt: now });
  }
  await new BuddySupportCommand(runtime.database).enroll("user_alice", id);
}

test("two real HTTP accounts keep a flower and single acknowledgement across backend restart", async () => {
  let app = await boot(); let noteID = "";
  try {
    const alice = await login(app.origin, "alice@example.com"), bob = await login(app.origin, "bob@example.com");
    // Login establishes both FrogSleep memberships before support enrollment.
    await prepare(app.runtime);
    await call(app.origin, "PUT", "/buddy-support/permissions/support_http_sleep", bob, { enabled: true, expected_revision: 0, operation_id: "http_enable" });
    const body = { relationship_id: "support_http_sleep", operation_id: "http_send", template_key: "sleep_goodnight", flower: true };
    const sent = await call(app.origin, "POST", "/buddy-support/notes", alice, body); noteID = sent.note.id;
    assert.equal((await call(app.origin, "POST", "/buddy-support/notes", alice, body)).note.id, noteID);
    await call(app.origin, "POST", `/buddy-support/notes/${noteID}/acknowledgement`, bob, { operation_id: "http_ack" });
    await call(app.origin, "POST", `/buddy-support/notes/${noteID}/acknowledgement`, bob, { operation_id: "http_ack_again" });
    await call(app.origin, "PUT", "/buddy-support/permissions/support_http_sleep", bob, { enabled: false, expected_revision: 1, operation_id: "http_off" });
  } finally { await app.close(); }
  app = await boot();
  try {
    const bob = await login(app.origin, "bob@example.com");
    const history = await call(app.origin, "GET", "/buddy-support/notes", bob);
    const note = history.notes.find((value: { id: string }) => value.id === noteID);
    assert.equal(note.flower, true); assert.equal(note.acknowledged, true); assert.equal(note.can_acknowledge, false);
    process.env.FROGSLEEP_BUDDY_SUPPORT_ENABLED = "false";
    assert.equal((await call(app.origin, "GET", "/buddy-support/center", bob)).enabled, false);
    assert.equal((await call(app.origin, "GET", "/me", bob)).user_id, "user_bob");
  } finally { process.env.FROGSLEEP_BUDDY_SUPPORT_ENABLED = "true"; await app.close(); }
});
