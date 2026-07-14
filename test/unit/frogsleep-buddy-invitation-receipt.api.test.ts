import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

const capabilityVariables = [
  "FROGSLEEP_BUDDY_INBOX_ENABLED",
  "FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED",
] as const;

async function runtime() {
  return await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed) });
}

async function login(app: Awaited<ReturnType<typeof runtime>>, account = "alice@example.com") {
  const response = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/auth/password/login",
    headers: {}, body: { account, password: "Password1234" }, requestId: `receipt_login_${account}` } as never);
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

function auth(token: string) { return { authorization: `Bearer ${token}` }; }

function preserveCapabilities() {
  const saved = Object.fromEntries(capabilityVariables.map((name) => [name, process.env[name]]));
  return () => capabilityVariables.forEach((name) => {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
}

function enableCreate() {
  process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";
}

test("email invitation receipts bind eligible accounts but expose only an opaque recorded receipt", async () => {
  const restore = preserveCapabilities();
  enableCreate();
  try {
    const app = await runtime();
    const alice = await login(app);
    const response = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/invitation-receipts",
      headers: auth(alice), body: { email: "  BOB@Example.com ", domains: ["focus", "sleep"] }, requestId: "receipt_registered" } as never);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(Object.keys(response.body.data).sort(), ["expires_at", "receipt_id", "status"]);
    assert.equal(response.body.data.status, "recorded");
    assert.ok(String(response.body.data.receipt_id).startsWith("buddy_receipt_"));
    assert.ok(!Number.isNaN(Date.parse(String(response.body.data.expires_at))));
    assert.equal(JSON.stringify(response.body.data).includes("bob@example.com"), false);
    assert.equal(JSON.stringify(response.body.data).includes("user_bob"), false);
    assert.equal(JSON.stringify(response.body.data).includes("sleep"), false);
    const stored = app.database.frogSleepBuddyInvitationReceiptAttempts[0]!;
    assert.equal(stored.inviteeUserId, "user_bob");
    assert.equal(stored.status, "recorded");
    assert.equal(stored.recipientIdentityHash.length, 64);
    assert.deepEqual(stored.domains, ["focus", "sleep"]);
    assert.equal(app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "sleep_invite" }).length, 0);
    assert.equal(app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "focus_invite" }).length, 0);
    assert.equal(app.database.frogSleepBuddyInvitationBundles.length, 0);
    assert.equal(app.database.frogSleepBuddyNotificationOutbox.length, 0);
  } finally { restore(); }
});

test("unregistered and self email receipts use indistinguishable decoy facts", async () => {
  const restore = preserveCapabilities();
  enableCreate();
  try {
    const app = await runtime();
    const alice = await login(app);
    const unregistered = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/invitation-receipts",
      headers: auth(alice), body: { email: "nobody@example.com", domains: ["sleep"] }, requestId: "receipt_unregistered" } as never);
    const self = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/invitation-receipts",
      headers: auth(alice), body: { email: "alice@example.com", domains: ["sleep"] }, requestId: "receipt_self" } as never);

    assert.equal(unregistered.statusCode, 200);
    assert.equal(self.statusCode, 200);
    assert.deepEqual(Object.keys(unregistered.body.data).sort(), Object.keys(self.body.data).sort());
    assert.equal(unregistered.body.data.status, "recorded");
    assert.equal(self.body.data.status, "recorded");
    assert.deepEqual(app.database.frogSleepBuddyInvitationReceiptAttempts.map((item) => item.status), ["decoy", "decoy"]);
    assert.deepEqual(app.database.frogSleepBuddyInvitationReceiptAttempts.map((item) => item.inviteeUserId), [undefined, undefined]);
  } finally { restore(); }
});

test("email receipts are idempotent across email case and domain order", async () => {
  const restore = preserveCapabilities();
  enableCreate();
  try {
    const app = await runtime();
    const alice = await login(app);
    const first = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/invitation-receipts",
      headers: auth(alice), body: { email: "bob@example.com", domains: ["sleep", "focus"] }, requestId: "receipt_first" } as never);
    const replay = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/invitation-receipts",
      headers: auth(alice), body: { email: " BOB@example.com ", domains: ["focus", "sleep"] }, requestId: "receipt_replay" } as never);

    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.data.receipt_id, first.body.data.receipt_id);
    assert.equal(replay.body.data.expires_at, first.body.data.expires_at);
    assert.equal(app.database.frogSleepBuddyInvitationReceiptAttempts.length, 1);
  } finally { restore(); }
});

test("email receipt command rejects invalid body and stays unreachable while create capability is off", async () => {
  const restore = preserveCapabilities();
  try {
    const app = await runtime();
    const alice = await login(app);
    const unavailable = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/invitation-receipts",
      headers: auth(alice), body: { email: "bob@example.com", domains: ["sleep"] }, requestId: "receipt_disabled" } as never);
    assert.equal(unavailable.statusCode, 404);
    assert.equal(app.database.frogSleepBuddyInvitationReceiptAttempts.length, 0);

    enableCreate();
    for (const body of [
      { email: "not-an-email", domains: ["sleep"] },
      { email: "bob@example.com", domains: [] },
      { email: "bob@example.com", domains: ["sleep", "sleep"] },
      { email: "bob@example.com", domains: ["bundle"] },
      { email: "bob@example.com", domains: ["sleep"], target: "user_bob" },
    ]) {
      const invalid = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/invitation-receipts",
        headers: auth(alice), body, requestId: `receipt_invalid_${JSON.stringify(body)}` } as never);
      assert.equal(invalid.statusCode, 400);
      assert.equal(invalid.body.code, "REQ_INVALID_BODY");
    }
    assert.equal(app.database.frogSleepBuddyInvitationReceiptAttempts.length, 0);
  } finally { restore(); }
});
