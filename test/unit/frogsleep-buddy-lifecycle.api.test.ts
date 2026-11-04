import { FrogSleepSleepBuddyService } from "../../src/modules/frogsleep/sleep-buddy/sleep-buddy.service.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { BuddyNotificationService } from "../../src/modules/frogsleep/buddy-growth/buddy-notification.service.ts";
import { BuddyNotificationWorkerService } from "../../src/modules/frogsleep/buddy-growth/buddy-notification-worker.service.ts";
import { BuddyConsentService } from "../../src/modules/frogsleep/buddy-growth/buddy-consent.service.ts";

async function fixture() {
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory", databaseFactory: seed => new InMemoryDatabase(seed) });
  const bob = await app.database.findUserById("user_bob");
  await app.database.insertUser({ ...bob!, id: "user_charlie", email: "charlie@example.com" });
  const tokens: Record<string, string> = {};
  for (const user of ["alice", "bob", "charlie"]) {
    const login = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/auth/password/login", headers: {},
      body: { account: `${user}@example.com`, password: "Password1234" }, requestId: `login_${user}` } as never);
    assert.equal(login.statusCode, 200);
    tokens[user] = String(login.body.data.access_token);
  }
  const call = (actor: string, suffix: string, method = "GET", body?: unknown) => app.app.handle({ method,
    path: `/api/v1/frogsleep/buddy/${suffix}`, headers: { authorization: `Bearer ${tokens[actor]}` }, body, requestId: suffix } as never);
  const sleepCall = (actor: string, suffix: string, method = "GET", body?: unknown) => app.app.handle({ method,
    path: `/api/v1/frogsleep/sleep-buddy/${suffix}`, headers: { authorization: `Bearer ${tokens[actor]}` }, body, requestId: suffix } as never);
  await seedRelationship(app.database, "sleep_pair", "sleep");
  return { app, call, sleepCall, consent: new BuddyConsentService(app.database) };
}

async function seedRelationship(database: any, id: string, domain: "sleep" | "focus") {
  const now = new Date().toISOString();
  await database.insertFrogSleepBuddyDomainRelationship({ id, appId: "frogsleep", domain, userIdLow: "user_alice", userIdHigh: "user_bob",
    status: "active", pausedByUserIds: [], version: 1, createdAt: now, updatedAt: now });
  for (const userId of ["user_alice", "user_bob"]) {
    const slot = await database.ensureFrogSleepBuddyDomainSlot({ appId: "frogsleep", userId, domain, now });
    await database.compareAndUpdateFrogSleepBuddyDomainSlot({ appId: "frogsleep", userId, domain,
      state: "occupied", relationshipId: id, expectedVersion: slot.version, updatedAt: now });
  }
}

const zero = () => ({ presence: 0, daily_summary: 0, weekly_trend: 0, shared_activity: 0 });
async function shareConsent(consent: BuddyConsentService, actor = "user_alice", categories = ["daily_summary", "shared_activity", "weekly_trend"]) {
  const page = await consent.list(actor, "sleep_pair");
  const versions = Object.fromEntries(page.grants.filter(g => g.grantor_user_id === actor).map(g => [g.category, g.version]));
  return await consent.replaceOwn(actor, "sleep_pair", "sleep", categories, { ...zero(), ...versions });
}

async function seedNotification(database: any, type = "buddy_share", id = "share_one") {
  const now = new Date().toISOString();
  await database.insertFrogSleepEntity({ id, appId: "frogsleep", kind: type, ownerUserId: "user_alice", partnerUserId: "user_bob",
    relationshipId: "sleep_pair", status: "ready", payload: { type: "sleep_summary" }, createdAt: now, updatedAt: now });
  return await database.upsertFrogSleepBuddyNotification({ id: `notification_${id}`, appId: "frogsleep", recipientUserId: "user_bob",
    outboxId: `outbox_${id}`, notificationType: "interaction_received", targetType: type, targetId: id,
    safeRoute: { type, relationship_id: "sleep_pair", interaction_id: id }, createdAt: now, updatedAt: now });
}

test("canonical grants default to revoked; viewer selection affects only the viewer's direction and all categories atomically", async () => {
  const { call, app, consent } = await fixture();
  const before = await call("bob", "relationships/sleep_pair/grants");
  assert.equal(before.statusCode, 200); assert.equal(before.body.data.grants.length, 8);
  assert.ok(before.body.data.grants.every((g: any) => g.state === "revoked" && g.version === 0));
  assert.equal(app.database.frogSleepBuddySharingGrants.length, 0);
  const changed = await call("alice", "relationships/sleep_pair/grants", "PUT",
    { domain: "sleep", categories: ["presence", "daily_summary"], expected_versions: zero() });
  assert.equal(changed.statusCode, 200);
  assert.ok(changed.body.data.grants.filter((g: any) => g.grantor_user_id === "user_bob").every((g: any) => g.state === "revoked"));
  await consent.assertAuthorized("user_bob", "sleep_pair", "presence");
  await assert.rejects(consent.assertAuthorized("user_alice", "sleep_pair", "presence"), { statusCode: 403 });
  const grant = changed.body.data.grants.find((g: any) => g.grantor_user_id === "user_alice" && g.category === "presence");
  assert.equal((await call("bob", `relationships/sleep_pair/grants/${grant.id}`, "PATCH", { state: "revoked", expected_version: 1 })).statusCode, 403);
  assert.equal((await call("charlie", "relationships/sleep_pair/grants")).statusCode, 404);
  assert.equal((await call("alice", "relationships/sleep_pair/grants", "PUT", { domain: "focus", categories: [], expected_versions: zero() })).statusCode, 400);
});

test("two independent pauses require both users to resume, duplicate operations retain versions and paused relations still occupy slots", async () => {
  const { call, app, consent } = await fixture(); await shareConsent(consent);
  const pause = await call("alice", "relationships/sleep_pair/pause", "POST", { expected_version: 1 });
  assert.equal(pause.body.data.version, 2);
  assert.equal((await call("alice", "relationships/sleep_pair/pause", "POST", { expected_version: 1 })).body.data.version, 2);
  assert.equal((await call("bob", "relationships/sleep_pair/pause", "POST", { expected_version: 2 })).body.data.version, 3);
  const firstResume = await call("alice", "relationships/sleep_pair/resume", "POST", { expected_version: 3 });
  assert.deepEqual([firstResume.body.data.status, firstResume.body.data.paused_by_user_ids], ["paused", ["user_bob"]]);
  await assert.rejects(consent.assertAuthorized("user_bob", "sleep_pair", "daily_summary"), { statusCode: 404 });
  assert.equal((await call("alice", "relationships/sleep_pair/grants", "PUT", { domain: "sleep", categories: ["presence"], expected_versions: { ...zero(), daily_summary: 1, shared_activity: 1, weekly_trend: 1 } })).statusCode, 404);
  await shareConsent(consent, "user_alice", []);
  assert.equal((await call("bob", "relationships/sleep_pair/resume", "POST", { expected_version: 4 })).body.data.status, "active");
  assert.equal((await app.database.findFrogSleepBuddyDomainSlot("frogsleep", "user_alice", "sleep"))?.state, "occupied");
  assert.equal((await call("charlie", "relationships/sleep_pair/revoke", "POST", { expected_version: 5 })).statusCode, 404);
});

test("stale grant batch is rejected without partial changes; revocation gates session and notification reads immediately", async () => {
  const { app, call, consent } = await fixture(); await shareConsent(consent); const notification = await seedNotification(app.database);
  const notifications = new BuddyNotificationService(app.database);
  assert.equal((await notifications.resolve("user_bob", notification.id)).route.interaction_id, "share_one");
  assert.equal((await call("alice", "relationships/sleep_pair/grants", "PUT", { domain: "sleep", categories: ["presence"], expected_versions: zero() })).statusCode, 409);
  await consent.assertAuthorized("user_bob", "sleep_pair", "daily_summary");
  await shareConsent(consent, "user_alice", []);
  await assert.rejects(notifications.resolve("user_bob", notification.id), { statusCode: 403 });
  await assert.rejects(consent.assertAuthorized("user_bob", "sleep_pair", "shared_activity"), { statusCode: 403 });
});

test("mute is recipient-specific without revoking grants, and worker retries recheck current silence and grant authorization", async () => {
  const { app, call, consent } = await fixture(); await shareConsent(consent);
  const notification = await seedNotification(app.database);
  assert.equal((await call("bob", "relationships/sleep_pair/mute", "POST", { expected_version: 1 })).body.data.is_muted, true);
  assert.equal((await call("alice", "relationships/sleep_pair")).body.data.is_muted, false);
  await consent.assertAuthorized("user_bob", "sleep_pair", "daily_summary");
  const now = new Date().toISOString();
  await app.database.enqueueFrogSleepBuddyNotificationOutbox({ id: "retry_silence", appId: "frogsleep", recipientUserId: "user_bob",
    eventType: "interaction_received", targetType: notification.targetType, targetId: notification.targetId, safeRoute: notification.safeRoute,
    deduplicationKey: "retry_silence", status: "failed", attemptCount: 1, availableAt: now, createdAt: now, updatedAt: now });
  let queues = 0;
  const worker = new BuddyNotificationWorkerService(app.database, { queueNotification: async () => { queues++; return { queued: true }; } } as never, undefined, true);
  await worker.processBatch(); assert.equal(queues, 0);
  assert.equal(app.database.frogSleepBuddyNotificationOutbox.find(r => r.id === "retry_silence")?.lastErrorCode, "TARGET_UNAUTHORIZED");
  assert.equal((await call("bob", "relationships/sleep_pair/unmute", "POST", { expected_version: 1 })).body.data.is_muted, false);
});

test("解除 clears both grants and shared coordination only; replay cannot release a newly occupied slot or reactivate sessions", async () => {
  const { app, call, consent } = await fixture(); await shareConsent(consent); await shareConsent(consent, "user_bob");
  const now = new Date().toISOString();
  for (const [id, relationshipId] of [["shared_session", "sleep_pair"], ["private_session", undefined]]) {
    await app.database.insertFrogSleepEntity({ id, appId: "frogsleep", kind: "sleep_session", ownerUserId: "user_alice",
      relationshipId, status: "active", payload: {}, createdAt: now, updatedAt: now });
  }
  const revoked = await call("alice", "relationships/sleep_pair/revoke", "POST", { expected_version: 1 });
  assert.equal(revoked.statusCode, 200); assert.equal(revoked.body.data.status, "revoked");
  assert.equal((await app.database.findFrogSleepEntity("sleep_session", "frogsleep", "shared_session"))?.status, "cancelled");
  assert.equal((await app.database.findFrogSleepEntity("sleep_session", "frogsleep", "private_session"))?.status, "active");
  assert.ok(app.database.frogSleepBuddySharingGrants.every(g => g.state === "revoked"));
  await seedRelationship(app.database, "new_pair", "sleep");
  assert.equal((await call("bob", "relationships/sleep_pair/revoke", "POST", { expected_version: 1 })).statusCode, 200);
  assert.equal((await app.database.findFrogSleepBuddyDomainSlot("frogsleep", "user_bob", "sleep"))?.relationshipId, "new_pair");
  assert.equal((await call("alice", "relationships/sleep_pair/resume", "POST", { expected_version: 2 })).statusCode, 409);
  assert.equal((await call("alice", "relationships/sleep_pair/grants", "PUT", { domain: "sleep", categories: ["presence"], expected_versions: zero() })).statusCode, 404);
});

test("block revokes canonical and compatibility relationships in both domains; unblock does not restore relationships or notification access", async () => {
  const { app, call, consent } = await fixture(); await seedRelationship(app.database, "focus_pair", "focus"); await shareConsent(consent);
  const notification = await seedNotification(app.database); const now = new Date().toISOString();
  await app.database.insertFrogSleepEntity({ id: "legacy_focus", appId: "frogsleep", kind: "focus_relationship", ownerUserId: "user_alice",
    partnerUserId: "user_bob", status: "accepted", payload: {}, createdAt: now, updatedAt: now });
  const first = await call("alice", "users/user_bob/block", "POST", {});
  const second = await call("alice", "users/user_bob/block", "POST", {});
  assert.equal(first.statusCode, 200); assert.equal(second.body.data.id, first.body.data.id);
  for (const id of ["sleep_pair", "focus_pair"]) assert.equal((await app.database.findFrogSleepBuddyDomainRelationship("frogsleep", id))?.status, "revoked");
  assert.equal((await app.database.findFrogSleepEntity("focus_relationship", "frogsleep", "legacy_focus"))?.status, "revoked");
  assert.ok((await app.database.listFrogSleepBuddyDomainSlots("frogsleep", "user_alice")).every(s => s.state === "available"));
  await call("alice", "users/user_bob/unblock", "POST");
  await assert.rejects(new BuddyNotificationService(app.database).resolve("user_bob", notification.id));
  assert.equal((await call("bob", "relationships/sleep_pair/resume", "POST", { expected_version: 2 })).statusCode, 409);
});

test("notification route verifies kind, all route IDs, recipient membership, expiry and current grants for goals and reports", async () => {
  const { app, consent } = await fixture(); await shareConsent(consent); const service = new BuddyNotificationService(app.database);
  for (const [type, id] of [["buddy_joint_goal", "goal_one"], ["buddy_milestone", "milestone_one"], ["buddy_weekly_report", "report_one"]]) {
    const notification = await seedNotification(app.database, type, id);
    assert.equal((await service.resolve("user_bob", notification.id)).notification_id, notification.id);
    await assert.rejects(service.resolve("user_charlie", notification.id), { statusCode: 404 });
    const forged = await app.database.upsertFrogSleepBuddyNotification({ ...notification, id: `forged_${id}`, outboxId: `forged_${id}`, safeRoute: { ...notification.safeRoute, report_id: "forged" } });
    await assert.rejects(service.resolve("user_bob", forged.id), { statusCode: 404 });
    const wrongKind = await app.database.upsertFrogSleepBuddyNotification({ ...notification, id: `kind_${id}`, outboxId: `kind_${id}`, targetType: "buddy_invitation" });
    await assert.rejects(service.resolve("user_bob", wrongKind.id), { statusCode: 404 });
    const expired = await app.database.upsertFrogSleepBuddyNotification({ ...notification, id: `expired_${id}`, outboxId: `expired_${id}`, expiresAt: "2020-01-01T00:00:00Z" });
    await assert.rejects(service.resolve("user_bob", expired.id), { statusCode: 404 });
  }
});


test("real shared-session reads, events and accept are gated after pause and revoke without reviving old sessions on resume", async () => {
  const { app, call, sleepCall, consent } = await fixture(); await shareConsent(consent); await shareConsent(consent, "user_bob");
  const started = await sleepCall("alice", "shared-sessions", "POST", { relationship_id: "sleep_pair", date_anchor: "2026-10-11" });
  assert.equal(started.statusCode, 200); const id = String(started.body.data.session_id);
  assert.equal((await sleepCall("bob", `shared-sessions/${id}/accept`, "POST")).statusCode, 200);
  const timestamp = new Date().toISOString();
  await app.database.insertFrogSleepEntity({ id: "shared_summary", appId: "frogsleep", kind: "sleep_summary", ownerUserId: "user_bob",
    relationshipId: "sleep_pair", status: "ready", payload: { date_anchor: "2026-10-11", headline: "shared" }, createdAt: timestamp, updatedAt: timestamp });
  assert.equal((await sleepCall("bob", "shared-summaries/latest")).body.data.summary.headline, "shared");
  await call("bob", "relationships/sleep_pair/pause", "POST", { expected_version: 1 });
  assert.equal((await sleepCall("bob", "shared-sessions/active")).body.data.session, null);
  assert.equal((await sleepCall("bob", "shared-summaries/latest")).body.data.summary, null);
  assert.equal((await sleepCall("alice", `shared-sessions/${id}/events`, "POST", { event_type: "returned" })).statusCode, 409);
  await call("bob", "relationships/sleep_pair/resume", "POST", { expected_version: 2 });
  assert.equal((await sleepCall("bob", `shared-sessions/${id}/accept`, "POST")).statusCode, 409);
  const next = await sleepCall("alice", "shared-sessions", "POST", { relationship_id: "sleep_pair", date_anchor: "2026-10-11" });
  assert.equal(next.statusCode, 200); assert.notEqual(next.body.data.session_id, id);
  await shareConsent(consent, "user_alice", []);
  assert.equal((await sleepCall("bob", "shared-summaries/latest")).body.data.summary.redacted, true);
  assert.equal((await sleepCall("bob", `shared-sessions/${next.body.data.session_id}/accept`, "POST")).statusCode, 409);
  await call("alice", "relationships/sleep_pair/revoke", "POST", { expected_version: 3 });
  assert.equal((await sleepCall("alice", "shared-sessions", "POST", { relationship_id: "sleep_pair" })).statusCode, 409);
});


test("one-way sharing lets the grantor publish their own summary and only the grantee read it", async () => {
  const { app, call, consent } = await fixture(); await shareConsent(consent);
  const { BuddyGrowthHubService } = await import("../../src/modules/frogsleep/buddy-growth/buddy-growth-hub.service.ts");
  const share = await new BuddyGrowthHubService(app.database).createShare("user_alice", { relationship_id: "sleep_pair", type: "sleep_summary",
    snapshot: { duration_minutes: 420 }, idempotency_key: "one-way-summary" });
  assert.equal(share.payload.snapshot.duration_minutes, 420);
  await assert.rejects(consent.assertAuthorized("user_alice", "sleep_pair", "daily_summary"), { statusCode: 403 });
  await consent.assertAuthorized("user_bob", "sleep_pair", "daily_summary");
});

test("legacy shared sleep Push also honors relation silence and legacy preferences cannot overwrite the mute record", async () => {
  const { app, call, consent } = await fixture(); await shareConsent(consent); await shareConsent(consent, "user_bob");
  let queues = 0;
  const service = new FrogSleepSleepBuddyService(app.database, { queueNotification: async () => { queues++; return { queued: true }; } } as never);
  await call("bob", "relationships/sleep_pair/mute", "POST", { expected_version: 1 });
  await service.updatePreferences("user_bob", "sleep_pair", { guard_level: "strict" });
  assert.equal((await call("bob", "relationships/sleep_pair")).body.data.is_muted, true);
  const session = await service.beginSession("user_alice", "sleep_pair", "2026-10-11");
  await service.recordEvent("user_alice", session.session_id, "interrupted");
  assert.equal(queues, 0);
  await call("bob", "relationships/sleep_pair/unmute", "POST", { expected_version: 1 });
  await service.recordEvent("user_alice", session.session_id, "returned");
  assert.equal(queues, 1);
});


test("lifecycle endpoints cannot turn a pending legacy Focus invitation into an accepted relationship", async () => {
  const { app, call } = await fixture(); const timestamp = new Date().toISOString();
  await app.database.insertFrogSleepEntity({ id: "pending_focus", appId: "frogsleep", kind: "focus_relationship", ownerUserId: "user_alice",
    partnerUserId: "user_bob", status: "pending", payload: {}, createdAt: timestamp, updatedAt: timestamp });
  for (const actor of ["alice", "bob"]) {
    assert.equal((await call(actor, "relationships/pending_focus")).statusCode, 404);
    for (const action of ["pause", "resume", "revoke", "mute"]) {
      assert.equal((await call(actor, `relationships/pending_focus/${action}`, "POST", { expected_version: 1 })).statusCode, 404);
    }
  }
  assert.equal((await app.database.findFrogSleepEntity("focus_relationship", "frogsleep", "pending_focus"))?.status, "pending");
  assert.equal(await app.database.findFrogSleepBuddyDomainSlot("frogsleep", "user_alice", "focus"), undefined);
});
