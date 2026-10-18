import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

const variables = ["FROGSLEEP_BUDDY_INBOX_ENABLED", "FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED"] as const;

async function runtime() {
  return await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed) });
}

async function login(app: Awaited<ReturnType<typeof runtime>>, account: string) {
  const response = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/auth/password/login",
    headers: {}, body: { account, password: "Password1234" }, requestId: `accept_login_${account}` } as never);
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

function auth(token: string) { return { authorization: `Bearer ${token}` }; }
function preserveCapabilities() {
  const saved = Object.fromEntries(variables.map((name) => [name, process.env[name]]));
  return () => variables.forEach((name) => saved[name] === undefined
    ? delete process.env[name] : process.env[name] = saved[name]);
}

async function seedBundle(app: Awaited<ReturnType<typeof runtime>>, domains: Array<"sleep" | "focus"> = ["sleep", "focus"]) {
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 86_400_000).toISOString();
  await app.database.upsertFrogSleepBuddyInvitationBundle({ id: "bundle_accept", appId: "frogsleep",
    inviterUserId: "user_alice", inviteeUserId: "user_bob", status: "pending", domains, version: 1,
    domainInvitationIds: {}, domainErrorCodes: {}, expiresAt, createdAt, updatedAt: createdAt });
  for (const domain of domains) await app.database.upsertFrogSleepBuddyInvitationDomainDecision({ appId: "frogsleep",
    invitationId: "bundle_accept", domain, status: "pending", version: 1, createdAt, updatedAt: createdAt });
}

async function accept(app: Awaited<ReturnType<typeof runtime>>, token: string, domain = "sleep", key = "accept-key", version = 1) {
  return await app.app.handle({ method: "POST",
    path: `/api/v1/frogsleep/buddy/invitations/bundle_accept/domains/${domain}/accept`, headers: auth(token),
    body: { expected_version: version, idempotency_key: key }, requestId: `accept_${domain}_${key}` } as never);
}

test("domain accept atomically accepts only one decision, occupies both slots and writes one safe outbox fact", async () => {
  const restore = preserveCapabilities();
  process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";
  try {
    const app = await runtime();
    const bob = await login(app, "bob@example.com");
    await seedBundle(app);
    const response = await accept(app, bob);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(Object.keys(response.body.data).sort(), ["decision_status", "decision_version", "domain",
      "invitation_id", "relationship_id", "relationship_status"]);
    assert.deepEqual([response.body.data.domain, response.body.data.decision_status,
      response.body.data.decision_version, response.body.data.relationship_status], ["sleep", "accepted", 2, "active"]);
    const sleep = await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_accept", "sleep");
    const focus = await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_accept", "focus");
    assert.equal(sleep?.idempotencyKeyHash, createHash("sha256").update("accept-key").digest("hex"));
    assert.equal(sleep?.decidedByUserId, "user_bob");
    assert.deepEqual([focus?.status, focus?.version], ["pending", 1]);
    const relationshipId = String(response.body.data.relationship_id);
    assert.equal((await app.database.findFrogSleepBuddyDomainSlot("frogsleep", "user_alice", "sleep"))?.relationshipId, relationshipId);
    assert.equal((await app.database.findFrogSleepBuddyDomainSlot("frogsleep", "user_bob", "sleep"))?.relationshipId, relationshipId);
    assert.equal((await app.database.findFrogSleepBuddyDomainRelationship("frogsleep", relationshipId))?.status, "active");
    assert.equal(app.database.frogSleepBuddyNotificationOutbox.length, 1);
    assert.equal(app.database.frogSleepBuddyNotificationOutbox[0]?.recipientUserId, "user_alice");
    assert.equal(app.database.frogSleepBuddySharingGrants.length, 8);
    assert.equal(app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "sleep_relationship" }).length, 0);
    assert.equal((await app.database.findFrogSleepBuddyInvitationBundle("frogsleep", "bundle_accept"))?.status, "pending");
  } finally { restore(); }
});

test("same accept key replays authoritatively while another key or stale version conflicts", async () => {
  const restore = preserveCapabilities();
  process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";
  try {
    const app = await runtime(); const bob = await login(app, "bob@example.com"); await seedBundle(app, ["focus"]);
    const first = await accept(app, bob, "focus", "same-key");
    const inviterSlot = await app.database.findFrogSleepBuddyDomainSlot("frogsleep", "user_alice", "focus");
    const inviteeSlot = await app.database.findFrogSleepBuddyDomainSlot("frogsleep", "user_bob", "focus");
    const replay = await accept(app, bob, "focus", "same-key");
    const different = await accept(app, bob, "focus", "different-key", 2);
    assert.equal(first.statusCode, 200);
    assert.deepEqual(replay.body.data, first.body.data);
    assert.equal(different.statusCode, 409);
    assert.equal(app.database.frogSleepBuddyNotificationOutbox.length, 1);
    assert.equal((await app.database.findFrogSleepBuddyDomainSlot("frogsleep", "user_alice", "focus"))?.version, inviterSlot?.version);
    assert.equal((await app.database.findFrogSleepBuddyDomainSlot("frogsleep", "user_bob", "focus"))?.version, inviteeSlot?.version);
    assert.equal((await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_accept", "focus"))?.version, 2);
  } finally { restore(); }
});

for (const terminalization of ["expired", "legacy-terminal"] as const) {
  test(`same-key accepted decision replays after bundle ${terminalization} without writes`, async () => {
    const restore = preserveCapabilities();
    process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
    process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";
    try {
      const app = await runtime(); const bob = await login(app, "bob@example.com");
      const alice = await login(app, "alice@example.com"); await seedBundle(app, ["sleep"]);
      const first = await accept(app, bob, "sleep", "replay-after-terminal");
      const bundle = await app.database.findFrogSleepBuddyInvitationBundle("frogsleep", "bundle_accept");
      await app.database.upsertFrogSleepBuddyInvitationBundle({ ...bundle!,
        status: terminalization === "expired" ? "expired" : "accepted",
        expiresAt: terminalization === "expired" ? "2020-01-01T00:00:00.000Z" : bundle!.expiresAt,
        version: bundle!.version + 1, updatedAt: new Date().toISOString() });
      const before = {
        relationships: app.database.frogSleepBuddyDomainRelationships.length,
        outbox: app.database.frogSleepBuddyNotificationOutbox.length,
        decision: await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_accept", "sleep"),
        inviterSlot: await app.database.findFrogSleepBuddyDomainSlot("frogsleep", "user_alice", "sleep"),
        inviteeSlot: await app.database.findFrogSleepBuddyDomainSlot("frogsleep", "user_bob", "sleep"),
      };
      const replay = await accept(app, bob, "sleep", "replay-after-terminal");
      const wrongActor = await accept(app, alice, "sleep", "replay-after-terminal");
      assert.equal(first.statusCode, 200);
      assert.deepEqual(replay.body.data, first.body.data);
      assert.equal(wrongActor.statusCode, 404);
      assert.equal(app.database.frogSleepBuddyDomainRelationships.length, before.relationships);
      assert.equal(app.database.frogSleepBuddyNotificationOutbox.length, before.outbox);
      assert.deepEqual(await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_accept", "sleep"), before.decision);
      assert.deepEqual(await app.database.findFrogSleepBuddyDomainSlot("frogsleep", "user_alice", "sleep"), before.inviterSlot);
      assert.deepEqual(await app.database.findFrogSleepBuddyDomainSlot("frogsleep", "user_bob", "sleep"), before.inviteeSlot);
    } finally { restore(); }
  });
}

test("domain accept requires expected_version to be a positive JSON integer number", async () => {
  const restore = preserveCapabilities();
  process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";
  try {
    for (const expectedVersion of ["1", true]) {
      const app = await runtime(); const bob = await login(app, "bob@example.com"); await seedBundle(app, ["sleep"]);
      const response = await app.app.handle({ method: "POST",
        path: "/api/v1/frogsleep/buddy/invitations/bundle_accept/domains/sleep/accept", headers: auth(bob),
        body: { expected_version: expectedVersion, idempotency_key: "typed-version" },
        requestId: `typed_version_${String(expectedVersion)}` } as never);
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, "REQ_INVALID_BODY");
      assert.equal(app.database.frogSleepBuddyDomainRelationships.length, 0);
      assert.equal(app.database.frogSleepBuddyNotificationOutbox.length, 0);
    }
  } finally { restore(); }
});

test("domain accept rejects wrong actors neutrally and rolls back an occupied slot", async () => {
  const restore = preserveCapabilities();
  process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";
  try {
    const app = await runtime(); const alice = await login(app, "alice@example.com");
    const bob = await login(app, "bob@example.com"); await seedBundle(app);
    assert.equal((await accept(app, alice)).statusCode, 404);
    const slot = await app.database.ensureFrogSleepBuddyDomainSlot({ appId: "frogsleep", userId: "user_alice",
      domain: "sleep", now: new Date().toISOString() });
    await app.database.compareAndUpdateFrogSleepBuddyDomainSlot({ appId: "frogsleep", userId: "user_alice",
      domain: "sleep", expectedVersion: slot.version, state: "occupied", relationshipId: "existing",
      updatedAt: new Date().toISOString() });
    const occupied = await accept(app, bob);
    assert.equal(occupied.statusCode, 409);
    assert.equal(occupied.body.code, "BUDDY_DOMAIN_SLOT_OCCUPIED");
    assert.equal((await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_accept", "sleep"))?.status, "pending");
    assert.equal(app.database.frogSleepBuddyDomainRelationships.length, 0);
    assert.equal(app.database.frogSleepBuddyNotificationOutbox.length, 0);
  } finally { restore(); }
});

test("domain accept rejects blocked, expired, absent-domain, stale and invalid requests without writes", async () => {
  const restore = preserveCapabilities();
  process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";
  try {
    const scenarios = ["blocked", "expired", "absent", "stale", "invalid-domain", "invalid-body"] as const;
    for (const scenario of scenarios) {
      const app = await runtime(); const bob = await login(app, "bob@example.com");
      await seedBundle(app, scenario === "absent" ? ["focus"] : ["sleep"]);
      if (scenario === "blocked") {
        const now = new Date().toISOString();
        await app.database.insertFrogSleepEntity({ id: "block_accept", appId: "frogsleep", kind: "focus_match_feedback",
          ownerUserId: "user_alice", partnerUserId: "user_bob", status: "blocked", payload: {}, createdAt: now, updatedAt: now });
      }
      if (scenario === "expired") {
        const bundle = await app.database.findFrogSleepBuddyInvitationBundle("frogsleep", "bundle_accept");
        await app.database.upsertFrogSleepBuddyInvitationBundle({ ...bundle!, expiresAt: "2020-01-01T00:00:00.000Z" });
      }
      const response = scenario === "invalid-domain" ? await accept(app, bob, "bundle")
        : scenario === "invalid-body" ? await app.app.handle({ method: "POST",
          path: "/api/v1/frogsleep/buddy/invitations/bundle_accept/domains/sleep/accept", headers: auth(bob),
          body: { expected_version: 0, idempotency_key: " " }, requestId: "invalid_accept_body" } as never)
        : await accept(app, bob, "sleep", "scenario-key", scenario === "stale" ? 2 : 1);
      assert.equal(response.statusCode, scenario === "absent" ? 404 : scenario === "blocked" ? 403 : scenario === "invalid-domain" || scenario === "invalid-body" ? 400 : 409);
      assert.equal(app.database.frogSleepBuddyDomainRelationships.length, 0);
      assert.equal(app.database.frogSleepBuddyNotificationOutbox.length, 0);
      const decision = await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_accept",
        scenario === "absent" ? "focus" : "sleep");
      assert.deepEqual([decision?.status, decision?.version], ["pending", 1]);
    }
  } finally { restore(); }
});

for (const occupiedUserId of ["user_alice", "user_bob"] as const) {
  test(`domain accept rolls back fully when ${occupiedUserId} slot is occupied`, async () => {
    const restore = preserveCapabilities();
    process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
    process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";
    try {
      const app = await runtime(); const bob = await login(app, "bob@example.com"); await seedBundle(app, ["sleep"]);
      const slot = await app.database.ensureFrogSleepBuddyDomainSlot({ appId: "frogsleep", userId: occupiedUserId,
        domain: "sleep", now: new Date().toISOString() });
      await app.database.compareAndUpdateFrogSleepBuddyDomainSlot({ appId: "frogsleep", userId: occupiedUserId,
        domain: "sleep", expectedVersion: slot.version, state: "occupied", relationshipId: "existing",
        updatedAt: new Date().toISOString() });
      const response = await accept(app, bob);
      assert.equal(response.body.code, "BUDDY_DOMAIN_SLOT_OCCUPIED");
      assert.equal(app.database.frogSleepBuddyDomainRelationships.length, 0);
      assert.equal(app.database.frogSleepBuddyNotificationOutbox.length, 0);
      assert.deepEqual([(await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_accept", "sleep"))?.status,
        (await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_accept", "sleep"))?.version], ["pending", 1]);
    } finally { restore(); }
  });
}

test("domain accept stays unreachable before authentication and writes while accept capability is off", async () => {
  const restore = preserveCapabilities();
  process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
  delete process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED;
  try {
    const app = await runtime(); await seedBundle(app);
    const response = await accept(app, "invalid-token");
    assert.equal(response.statusCode, 404);
    assert.equal((await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_accept", "sleep"))?.status, "pending");
  } finally { restore(); }
});

for (const domain of ["sleep", "focus"] as const) {
  test(`${domain} acceptance exposes independently revoked grants and preserves the other domain`, async () => {
    const restore = preserveCapabilities();
    process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
    process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";
    try {
      const app = await runtime();
      const bob = await login(app, "bob@example.com");
      const alice = await login(app, "alice@example.com");
      await seedBundle(app);
      const accepted = await accept(app, bob, domain, `consent-${domain}`);
      const relationshipId = String(accepted.body.data.relationship_id);
      const path = `/api/v1/frogsleep/buddy/relationships/${relationshipId}/grants`;
      const listed = await app.app.handle({ method: "GET", path, headers: auth(bob) } as never);
      assert.equal(listed.statusCode, 200);
      const grants = listed.body.data.grants;
      assert.equal(grants.length, 8);
      assert.ok(grants.every((grant: any) => grant.state === "revoked" && grant.domain === domain));
      const own = grants.find((grant: any) => grant.grantor_user_id === "user_bob" && grant.category === "daily_summary");
      const updated = await app.app.handle({ method: "PATCH", path: `${path}/${own.id}`, headers: auth(bob),
        body: { expected_version: 1, state: "granted" } } as never);
      assert.equal(updated.statusCode, 200);
      const forbidden = await app.app.handle({ method: "PATCH", path: `${path}/${own.id}`, headers: auth(alice),
        body: { expected_version: 2, state: "revoked" } } as never);
      assert.equal(forbidden.statusCode, 403);
      const stale = await app.app.handle({ method: "PATCH", path: `${path}/${own.id}`, headers: auth(bob),
        body: { expected_version: 1, state: "revoked" } } as never);
      assert.equal(stale.statusCode, 409);
      const before = structuredClone(app.database.frogSleepBuddySharingGrants);
      assert.equal((await accept(app, bob, domain, `consent-${domain}`)).statusCode, 200);
      assert.deepEqual(app.database.frogSleepBuddySharingGrants, before);
      const other = domain === "sleep" ? "focus" : "sleep";
      assert.equal((await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_accept", other))?.status, "pending");
      assert.equal(app.database.frogSleepBuddyDomainRelationships.length, 1);
    } finally { restore(); }
  });
}

test("grant initialization failure rolls back the relationship, slots, decision and grants", async () => {
  const restore = preserveCapabilities();
  process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";
  try {
    const app = await runtime(); const bob = await login(app, "bob@example.com"); await seedBundle(app);
    const original = app.database.upsertFrogSleepBuddySharingGrant.bind(app.database);
    let writes = 0;
    app.database.upsertFrogSleepBuddySharingGrant = (record) => {
      if (++writes === 3) throw new Error("storage unavailable");
      return original(record);
    };
    assert.equal((await accept(app, bob)).statusCode, 500);
    assert.equal(app.database.frogSleepBuddyDomainRelationships.length, 0);
    assert.equal(app.database.frogSleepBuddySharingGrants.length, 0);
    assert.equal(app.database.frogSleepBuddyNotificationOutbox.length, 0);
    assert.equal((await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "bundle_accept", "sleep"))?.status, "pending");
  } finally { restore(); }
});

test("preview retains the accepted domain version while the other domain is still pending", async () => {
  const restore = preserveCapabilities();
  process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";
  try {
    const app = await runtime(); const bob = await login(app, "bob@example.com"); await seedBundle(app);
    const accepted = await accept(app, bob);
    const preview = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/invitations/bundle_accept", headers: auth(bob) } as never);
    assert.equal(preview.statusCode, 200);
    const sleep = preview.body.data.domain_results.find((result: any) => result.domain === "sleep");
    assert.equal(sleep.status, "accepted");
    assert.equal(sleep.decision_version, 2);
    assert.equal(sleep.relationship_id, accepted.body.data.relationship_id);
    const focus = preview.body.data.domain_results.find((result: any) => result.domain === "focus");
    assert.equal(focus.status, "pending");
    assert.equal(focus.decision_version, 1);
  } finally { restore(); }
});
