import assert from "node:assert/strict";
import test from "node:test";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function runtime() {
  return await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed) });
}

async function login(app: Awaited<ReturnType<typeof runtime>>, account: string) {
  const response = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/auth/password/login",
    headers: {}, body: { account, password: "Password1234" }, requestId: `hub_login_${account}` } as never);
  return String(response.body.data.access_token);
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function acceptedSleepRelationship(app: Awaited<ReturnType<typeof runtime>>, alice: string, bob: string) {
  const invite = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: auth(alice), body: { invitee: "user_bob" }, requestId: "hub_sleep_invite" } as never);
  const accepted = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites/accept-code",
    headers: auth(bob), body: { code: invite.body.data.code }, requestId: "hub_sleep_accept" } as never);
  return String(accepted.body.data.relationship_id);
}

test("buddy hub consolidates same-person domains and separates different partners", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const sleepId = await acceptedSleepRelationship(app, alice, bob);
  const now = new Date().toISOString();
  await app.database.insertFrogSleepEntity({ id: "focus_bob", appId: "frogsleep", kind: "focus_relationship",
    ownerUserId: "user_alice", partnerUserId: "user_bob", status: "accepted", payload: {}, createdAt: now, updatedAt: now });
  await app.database.insertFrogSleepEntity({ id: "focus_charlie", appId: "frogsleep", kind: "focus_relationship",
    ownerUserId: "user_alice", partnerUserId: "user_charlie", status: "accepted", payload: {}, createdAt: now, updatedAt: now });
  const hub = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/hub",
    headers: auth(alice), requestId: "hub_snapshot" } as never);
  assert.equal(hub.statusCode, 200);
  assert.deepEqual(hub.body.data.partners.find((item: any) => item.user_id === "user_bob").domains.sort(), ["focus", "sleep"]);
  assert.deepEqual(hub.body.data.partners.find((item: any) => item.user_id === "user_charlie").domains, ["focus"]);
  assert.equal(hub.body.data.partners.some((item: any) => item.relationships.some((rel: any) => rel.relationship_id === sleepId)), true);
});

test("structured shares, bounded reactions, joint activities, pagination, and redaction form a growth loop", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const relationshipId = await acceptedSleepRelationship(app, alice, bob);
  const share = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/shares",
    headers: auth(alice), body: { relationship_id: relationshipId, type: "sleep_summary",
      idempotency_key: "share_once",
      snapshot: { duration_minutes: 420, schedule_met: true, raw_health_data: [1], private_note: "secret" } },
    requestId: "hub_share" } as never);
  assert.deepEqual(share.body.data.payload.snapshot, { duration_minutes: 420, schedule_met: true });
  const shareReplay = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/shares",
    headers: auth(alice), body: { relationship_id: relationshipId, type: "sleep_summary",
      idempotency_key: "share_once", snapshot: { duration_minutes: 999 } }, requestId: "hub_share_replay" } as never);
  assert.equal(shareReplay.body.data.id, share.body.data.id);
  const reaction = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/interactions",
    headers: auth(bob), body: { relationship_id: relationshipId, type: "encouragement",
      idempotency_key: "reaction_once", custom_text: "not stored" },
    requestId: "hub_reaction" } as never);
  assert.equal(reaction.body.data.payload.type, "encouragement");
  assert.equal("custom_text" in reaction.body.data.payload, false);
  const joint = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/joint-activities",
    headers: auth(alice), body: { relationship_id: relationshipId, type: "joint_focus",
      idempotency_key: "joint_once", planned_minutes: 25 },
    requestId: "hub_joint" } as never);
  const accepted = await app.app.handle({ method: "POST",
    path: `/api/v1/frogsleep/buddy/joint-activities/${joint.body.data.id}/accept`,
    headers: auth(bob), requestId: "hub_joint_accept" } as never);
  assert.equal(accepted.body.data.status, "accepted");
  const firstPage = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/activity",
    headers: auth(bob), query: { limit: "2" }, requestId: "hub_activity_page_1" } as never);
  assert.equal(firstPage.body.data.items.length, 2);
  assert.equal(typeof firstPage.body.data.next_cursor, "string");
  const storedShare = await app.database.findFrogSleepEntity("buddy_share", "frogsleep", share.body.data.id);
  await app.database.updateFrogSleepEntity("buddy_share", "frogsleep", share.body.data.id,
    { payload: { ...storedShare!.payload, expires_at: "2020-01-01T00:00:00.000Z" } });
  const expired = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/activity",
    headers: auth(bob), query: { limit: "10" }, requestId: "hub_activity_expired" } as never);
  assert.equal(expired.body.data.items.find((item: any) => item.id === share.body.data.id).unavailable_reason, "expired");
  await app.database.updateFrogSleepEntity("buddy_share", "frogsleep", share.body.data.id,
    { payload: { ...storedShare!.payload, expires_at: "2030-01-01T00:00:00.000Z" } });
  const grants = await app.app.handle({ method: "GET",
    path: `/api/v1/frogsleep/buddy/relationships/${relationshipId}/grants`, headers: auth(alice),
    requestId: "hub_grants" } as never);
  const grant = grants.body.data.grants.find((item: any) => item.grantor_user_id === "user_alice" &&
    item.grantee_user_id === "user_bob" && item.category === "daily_summary");
  await app.app.handle({ method: "PATCH",
    path: `/api/v1/frogsleep/buddy/relationships/${relationshipId}/grants/${grant.id}`,
    headers: auth(alice), body: { state: "revoked", expected_version: 1 }, requestId: "hub_revoke_share" } as never);
  const redacted = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/activity",
    headers: auth(bob), query: { limit: "10" }, requestId: "hub_activity_redacted" } as never);
  const redactedShare = redacted.body.data.items.find((item: any) => item.id === share.body.data.id);
  assert.equal(redactedShare.redacted, true);
  assert.equal(JSON.stringify(redactedShare).includes("420"), false);
  assert.equal(app.database.frogSleepBuddyNotificationOutbox.length, 5);
});
