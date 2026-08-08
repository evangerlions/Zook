import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

const capabilityVariables = [
  "FROGSLEEP_BUDDY_INBOX_ENABLED",
  "FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED",
] as const;

async function runtime() {
  return await createApplication({
    frogsleepEnabled: true,
    queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed),
  });
}

async function login(app: Awaited<ReturnType<typeof runtime>>) {
  const response = await app.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/auth/password/login",
    headers: {},
    body: { account: "alice@example.com", password: "Password1234" },
    requestId: "buddy_create_gate_login",
  } as never);
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

function preserveCapabilities() {
  const saved = Object.fromEntries(capabilityVariables.map((name) => [name, process.env[name]]));
  return () => capabilityVariables.forEach((name) => {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
}

test("unified invitation create stays unreachable without explicit consent and does not write", async () => {
  const restore = preserveCapabilities();
  process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
  delete process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED;

  try {
    const app = await runtime();
    const response = await app.app.handle({
      method: "POST",
      path: "/api/v1/frogsleep/buddy/invitations",
      headers: {},
      body: { target: "user_bob", domains: ["sleep"] },
      requestId: "buddy_create_gate_disabled",
    } as never);

    assert.equal(response.statusCode, 404);
    assert.equal(app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "sleep_invite" }).length, 0);
    assert.equal(app.database.listFrogSleepBuddyInvitationBundles({
      appId: "frogsleep", userId: "user_alice", direction: "outgoing",
    }).length, 0);
    assert.equal(app.database.frogSleepBuddyNotificationOutbox.length, 0);
  } finally {
    restore();
  }
});

test("unified invitation create remains available when inbox and explicit consent are enabled", async () => {
  const restore = preserveCapabilities();
  process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";

  try {
    const app = await runtime();
    const token = await login(app);
    const response = await app.app.handle({
      method: "POST",
      path: "/api/v1/frogsleep/buddy/invitations",
      headers: { authorization: `Bearer ${token}` },
      body: { target: "user_bob", domains: ["sleep"] },
      requestId: "buddy_create_gate_enabled",
    } as never);

    assert.equal(response.statusCode, 200);
    assert.ok(response.body.data.invitation_id);
  } finally {
    restore();
  }
});
