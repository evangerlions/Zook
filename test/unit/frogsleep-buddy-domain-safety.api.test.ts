import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

const capabilityVariables = ["FROGSLEEP_BUDDY_INBOX_ENABLED", "FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED"] as const;

async function runtime() {
  return await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed) });
}

async function login(app: Awaited<ReturnType<typeof runtime>>, account: string) {
  const response = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/auth/password/login",
    headers: {}, body: { account, password: "Password1234" }, requestId: `safety_login_${account}` } as never);
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

function auth(token: string) { return { authorization: `Bearer ${token}` }; }

function restoreCapabilities() {
  const saved = Object.fromEntries(capabilityVariables.map((name) => [name, process.env[name]]));
  return () => capabilityVariables.forEach((name) => saved[name] === undefined
    ? delete process.env[name] : process.env[name] = saved[name]);
}

async function seedBundle(app: Awaited<ReturnType<typeof runtime>>, options: { withSlots?: boolean } = {}) {
  const createdAt = new Date().toISOString();
  await app.database.upsertFrogSleepBuddyInvitationBundle({ id: "bundle_safety", appId: "frogsleep",
    inviterUserId: "user_alice", inviteeUserId: "user_bob", status: "pending", domains: ["sleep", "focus"],
    version: 1, domainInvitationIds: {}, domainErrorCodes: {},
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdAt, updatedAt: createdAt });
  for (const domain of ["sleep", "focus"] as const) {
    await app.database.upsertFrogSleepBuddyInvitationDomainDecision({ appId: "frogsleep", invitationId: "bundle_safety",
      domain, status: "pending", version: 1, createdAt, updatedAt: createdAt });
    if (options.withSlots !== false) {
      await app.database.ensureFrogSleepBuddyDomainSlot({ appId: "frogsleep", userId: "user_alice", domain, now: createdAt });
      await app.database.ensureFrogSleepBuddyDomainSlot({ appId: "frogsleep", userId: "user_bob", domain, now: createdAt });
    }
  }
}

async function command(app: Awaited<ReturnType<typeof runtime>>, token: string, action: "decline" | "cancel", input: {
  domain?: string; key?: string; version?: unknown;
} = {}) {
  const domain = input.domain ?? "sleep";
  const key = input.key ?? `${action}-key`;
  return await app.app.handle({ method: "POST",
    path: `/api/v1/frogsleep/buddy/invitations/bundle_safety/domains/${domain}/${action}`, headers: auth(token),
    body: { expected_version: input.version ?? 1, idempotency_key: key }, requestId: `${action}_${domain}_${key}` } as never);
}

test("domain decline bypasses disabled ordinary capabilities and writes only its decision plus one event", async () => {
  const restore = restoreCapabilities();
  delete process.env.FROGSLEEP_BUDDY_INBOX_ENABLED;
  delete process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED;
  try {
    const app = await runtime(); const bob = await login(app, "bob@example.com"); await seedBundle(app);
    const now = new Date().toISOString();
    await app.database.insertFrogSleepEntity({ id: "block_safety", appId: "frogsleep", kind: "focus_match_feedback",
      ownerUserId: "user_alice", partnerUserId: "user_bob", status: "blocked", payload: {}, createdAt: now, updatedAt: now });
    const before = { bundle: await app.database.findFrogSleepBuddyInvitationBundle("frogsleep", "bundle_safety"),
      aliceSlots: await app.database.listFrogSleepBuddyDomainSlots("frogsleep", "user_alice"),
      bobSlots: await app.database.listFrogSleepBuddyDomainSlots("frogsleep", "user_bob"),
      relationships: structuredClone(app.database.frogSleepBuddyDomainRelationships),
      grants: structuredClone(app.database.frogSleepBuddySharingGrants) };
    const response = await command(app, bob, "decline");

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data, { invitation_id: "bundle_safety", domain: "sleep",
      decision_status: "declined", decision_version: 2 });
    const sleep = await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_safety", "sleep");
    const focus = await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_safety", "focus");
    assert.equal(sleep?.idempotencyKeyHash, createHash("sha256").update("decline-key").digest("hex"));
    assert.equal(sleep?.terminalReason, "declined_by_invitee");
    assert.deepEqual([focus?.status, focus?.version], ["pending", 1]);
    assert.deepEqual(await app.database.findFrogSleepBuddyInvitationBundle("frogsleep", "bundle_safety"), before.bundle);
    assert.deepEqual(await app.database.listFrogSleepBuddyDomainSlots("frogsleep", "user_alice"), before.aliceSlots);
    assert.deepEqual(await app.database.listFrogSleepBuddyDomainSlots("frogsleep", "user_bob"), before.bobSlots);
    assert.deepEqual(app.database.frogSleepBuddyDomainRelationships, before.relationships);
    assert.deepEqual(app.database.frogSleepBuddySharingGrants, before.grants);
    assert.equal(app.database.frogSleepBuddyNotificationOutbox.length, 1);
    assert.deepEqual([app.database.frogSleepBuddyNotificationOutbox[0]?.eventType,
      app.database.frogSleepBuddyNotificationOutbox[0]?.recipientUserId], ["invitation_declined", "user_alice"]);
  } finally { restore(); }
});

test("domain decline leaves a fresh invitation with no slots completely slot-free", async () => {
  const restore = restoreCapabilities();
  delete process.env.FROGSLEEP_BUDDY_INBOX_ENABLED;
  delete process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED;
  try {
    const app = await runtime(); const bob = await login(app, "bob@example.com");
    await seedBundle(app, { withSlots: false });
    const response = await command(app, bob, "decline");

    assert.equal(response.statusCode, 200);
    assert.deepEqual(app.database.frogSleepBuddyDomainSlots, []);
    assert.deepEqual([(await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_safety", "sleep"))?.status,
      app.database.frogSleepBuddyNotificationOutbox.length], ["declined", 1]);
  } finally { restore(); }
});

test("domain cancel is inviter-only and sends the cancellation notification to the invitee", async () => {
  const restore = restoreCapabilities();
  delete process.env.FROGSLEEP_BUDDY_INBOX_ENABLED;
  delete process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED;
  try {
    const app = await runtime(); const alice = await login(app, "alice@example.com");
    const bob = await login(app, "bob@example.com"); await seedBundle(app);
    const wrongActor = await command(app, bob, "cancel", { domain: "focus" });
    const response = await command(app, alice, "cancel", { domain: "focus" });

    assert.equal(wrongActor.statusCode, 404);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data, { invitation_id: "bundle_safety", domain: "focus",
      decision_status: "cancelled", decision_version: 2 });
    assert.deepEqual([app.database.frogSleepBuddyNotificationOutbox[0]?.eventType,
      app.database.frogSleepBuddyNotificationOutbox[0]?.recipientUserId], ["invitation_cancelled", "user_bob"]);
  } finally { restore(); }
});

test("same-key safety replay remains read-only after a legacy terminal bundle while a different key conflicts", async () => {
  const restore = restoreCapabilities();
  delete process.env.FROGSLEEP_BUDDY_INBOX_ENABLED;
  delete process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED;
  try {
    const app = await runtime(); const bob = await login(app, "bob@example.com"); await seedBundle(app);
    const first = await command(app, bob, "decline", { key: "replay-key" });
    const bundle = await app.database.findFrogSleepBuddyInvitationBundle("frogsleep", "bundle_safety");
    await app.database.upsertFrogSleepBuddyInvitationBundle({ ...bundle!, status: "expired", version: 2,
      expiresAt: "2020-01-01T00:00:00.000Z", updatedAt: new Date().toISOString() });
    const before = { decision: await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_safety", "sleep"),
      outbox: structuredClone(app.database.frogSleepBuddyNotificationOutbox),
      slots: await app.database.listFrogSleepBuddyDomainSlots("frogsleep", "user_bob") };
    const replay = await command(app, bob, "decline", { key: "replay-key" });
    const conflictingReplay = await command(app, bob, "decline", { key: "replay-key", version: 2 });
    const different = await command(app, bob, "decline", { key: "different-key", version: 2 });

    assert.equal(first.statusCode, 200);
    assert.deepEqual(replay.body.data, first.body.data);
    assert.equal(conflictingReplay.statusCode, 409);
    assert.equal(different.statusCode, 409);
    assert.deepEqual(await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_safety", "sleep"), before.decision);
    assert.deepEqual(app.database.frogSleepBuddyNotificationOutbox, before.outbox);
    assert.deepEqual(await app.database.listFrogSleepBuddyDomainSlots("frogsleep", "user_bob"), before.slots);
  } finally { restore(); }
});

test("domain safety commands reject a non-number expected version", async () => {
  const restore = restoreCapabilities();
  delete process.env.FROGSLEEP_BUDDY_INBOX_ENABLED;
  delete process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED;
  try {
    const app = await runtime(); const bob = await login(app, "bob@example.com"); await seedBundle(app);
    const response = await command(app, bob, "decline", { version: "1" });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "REQ_INVALID_BODY");
    assert.equal((await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_safety", "sleep"))?.status, "pending");
  } finally { restore(); }
});
