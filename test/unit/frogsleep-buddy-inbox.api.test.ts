import assert from "node:assert/strict";
import test from "node:test";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { PublicContractValidator } from "../../src/generated/openapi/public-contract-validator.ts";
import { BuddyNotificationWorkerService } from "../../src/modules/frogsleep/buddy-growth/buddy-notification-worker.service.ts";

async function runtime() {
  return createApplication({ frogsleepEnabled: true, queueBackend: "memory", databaseFactory: (seed) => new InMemoryDatabase(seed) });
}

async function login(app: Awaited<ReturnType<typeof runtime>>, account: string) {
  const response = await app.app.handle({
    method: "POST", path: "/api/v1/frogsleep/auth/password/login", headers: {},
    body: { account, password: "Password1234" }, requestId: `login_${account}`,
  } as never);
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

test("generated validators cover unified invitation and directional grant requests", () => {
  assert.equal(PublicContractValidator.validateBuddyInvitationCreate({ target: "user_bob", domains: ["sleep", "focus"] }).ok, true);
  assert.equal(PublicContractValidator.validateBuddyInvitationCreate({ target: "user_bob", domains: ["bundle"] }).ok, false);
  assert.equal(PublicContractValidator.validateBuddyInvitationResponse({ expected_version: 1, idempotency_key: "once", sharing_categories: ["presence"] }).ok, true);
  assert.equal(PublicContractValidator.validateBuddyInvitationResponse({ expected_version: 0, idempotency_key: "" }).ok, false);
  assert.equal(PublicContractValidator.validateBuddySharingGrantUpdate({ state: "revoked", expected_version: 2 }).ok, true);
  assert.equal(PublicContractValidator.validateBuddySharingGrantUpdate({ state: "unknown", expected_version: 2 }).ok, false);
});

test("unified buddy inbox and outbox project sleep and focus invitations", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");

  const sleep = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites", headers: auth(alice), body: { invitee: "user_bob" }, requestId: "sleep_create" } as never);
  const focus = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/focus-buddy/invites", headers: auth(alice), body: { target: "user_bob" }, requestId: "focus_create" } as never);
  assert.equal(sleep.statusCode, 200);
  assert.equal(focus.statusCode, 200);

  const inbox = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/invitations", query: { direction: "incoming" }, headers: auth(bob), requestId: "bob_inbox" } as never);
  assert.equal(inbox.statusCode, 200);
  assert.deepEqual(new Set(inbox.body.data.invitations.map((item: any) => item.domain)), new Set(["sleep", "focus"]));
  assert.equal(inbox.body.data.invitations.every((item: any) => item.direction === "incoming"), true);
  assert.equal(inbox.body.data.invitations.every((item: any) => item.viewer_actions.includes("preview")), true);

  const outbox = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/invitations", query: { direction: "outgoing" }, headers: auth(alice), requestId: "alice_outbox" } as never);
  assert.equal(outbox.statusCode, 200);
  assert.equal(outbox.body.data.invitations.length, 2);
  assert.equal(outbox.body.data.invitations.every((item: any) => item.viewer_actions.includes("cancel")), true);

  const inviteId = String(sleep.body.data.invite_id);
  const preview = await app.app.handle({ method: "GET", path: `/api/v1/frogsleep/buddy/invitations/${inviteId}`, headers: auth(bob), requestId: "bob_preview" } as never);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.data.invitation_id, inviteId);
  assert.equal(preview.body.data.viewer_can_accept, true);
  assert.deepEqual(preview.body.data.proposed_sharing_categories, ["presence", "daily_summary"]);
  assert.equal(preview.body.data.share_code, undefined);
  const sentPreview = await app.app.handle({ method: "GET", path: `/api/v1/frogsleep/buddy/invitations/${inviteId}`, headers: auth(alice), requestId: "alice_preview" } as never);
  assert.equal(sentPreview.body.data.share_code, sleep.body.data.invite_code);
  assert.equal(String(sentPreview.body.data.share_link).includes("mode=preview"), true);

  const tokenPreview = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/invitations/preview", query: { token: String(sleep.body.data.invite_token) }, headers: auth(bob), requestId: "bob_token_preview" } as never);
  const codePreview = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/invitations/preview", query: { code: String(focus.body.data.invite_code) }, headers: auth(bob), requestId: "bob_code_preview" } as never);
  assert.equal(tokenPreview.statusCode, 200);
  assert.equal(codePreview.statusCode, 200);
  assert.equal(tokenPreview.body.data.status, "pending");
  assert.equal(codePreview.body.data.status, "pending");
  assert.equal((await app.database.findFrogSleepEntity("sleep_invite", "frogsleep", inviteId))?.status, "pending");

  await app.database.insertNotificationJob({
    id: "notification_invite_preview",
    appId: "frogsleep",
    recipientUserId: "user_bob",
    channel: "push",
    payload: { entityId: inviteId, type: "sleep_buddy_invite" },
    status: "PENDING",
    retryCount: 0,
  });
  const notificationPreview = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/invitations/preview", query: { notification_id: "notification_invite_preview" }, headers: auth(bob), requestId: "bob_notification_preview" } as never);
  assert.equal(notificationPreview.statusCode, 200);
  assert.equal(notificationPreview.body.data.invitation_id, inviteId);
});

test("focus pending invitations support sender cancellation", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/focus-buddy/invites", headers: auth(alice), body: { target: "user_bob" }, requestId: "focus_cancel_create" } as never);
  const inviteId = String(created.body.data.source_invite_id ?? created.body.data.raw_invite_id);
  const stored = await app.database.findFrogSleepEntityByCode("focus_invite", "frogsleep", String(created.body.data.invite_code));
  assert.ok(stored);

  const pending = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/focus-buddy/invites/pending", headers: auth(bob), requestId: "focus_pending" } as never);
  assert.equal(pending.statusCode, 200);
  assert.equal(pending.body.data.invites.length, 1);

  const cancelled = await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/focus-buddy/invites/${stored.id}/cancel`, headers: auth(alice), body: {}, requestId: "focus_cancel" } as never);
  assert.equal(cancelled.statusCode, 200);
  assert.equal(cancelled.body.data.status, "cancelled");

  const accept = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/focus-buddy/invites/accept-code", headers: auth(bob), body: { code: created.body.data.invite_code }, requestId: "focus_cancelled_accept" } as never);
  assert.equal(accept.statusCode, 400);
  assert.ok(inviteId || stored.id);
});

test("unified invitation response is explicit, versioned, and idempotent", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites", headers: auth(alice), body: { invitee: "user_bob" }, requestId: "unified_accept_create" } as never);
  const inviteId = String(created.body.data.invite_id);
  const request = { expected_version: 1, idempotency_key: "accept_once", sharing_categories: ["presence", "daily_summary"] };

  const accepted = await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/buddy/invitations/${inviteId}/accept`, headers: auth(bob), body: request, requestId: "unified_accept" } as never);
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.data.invitation_id, inviteId);
  assert.equal(accepted.body.data.results[0].status, "accepted");

  const replay = await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/buddy/invitations/${inviteId}/accept`, headers: auth(bob), body: request, requestId: "unified_accept_replay" } as never);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.data.results[0].relationship_id, accepted.body.data.results[0].relationship_id);
  const relationships = await app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "sleep_relationship", ownerUserId: "user_alice" });
  assert.equal(relationships.length, 1);
  assert.equal(app.database.frogSleepBuddyNotificationOutbox.filter((item) => item.targetId === inviteId && item.eventType === "invitation_created").length, 1);
  assert.equal(app.database.frogSleepBuddyNotificationOutbox.filter((item) => item.targetId === inviteId && item.eventType === "invitation_accepted").length, 1);
});

test("unified invitation response rejects stale expected version", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/focus-buddy/invites", headers: auth(alice), body: { target: "user_bob" }, requestId: "version_create" } as never);
  const stored = await app.database.findFrogSleepEntityByCode("focus_invite", "frogsleep", String(created.body.data.invite_code));
  const response = await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/buddy/invitations/${stored?.id}/decline`, headers: auth(bob), body: { expected_version: 9, idempotency_key: "stale" }, requestId: "version_stale" } as never);
  assert.equal(response.statusCode, 409);
  assert.equal((await app.database.findFrogSleepEntity("focus_invite", "frogsleep", stored!.id))?.status, "pending");
});

test("buddy block prevents accepting a pending invitation", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites", headers: auth(alice), body: { invitee: "user_bob" }, requestId: "blocked_create" } as never);
  await app.database.insertFrogSleepEntity({ id: "block_bob_alice", appId: "frogsleep", kind: "focus_match_feedback", ownerUserId: "user_bob", partnerUserId: "user_alice", status: "blocked", payload: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const response = await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/buddy/invitations/${created.body.data.invite_id}/accept`, headers: auth(bob), body: { expected_version: 1, idempotency_key: "blocked_accept" }, requestId: "blocked_accept" } as never);
  assert.equal(response.statusCode, 403);
});

test("accepting an invitation creates separate directional sharing grants", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites", headers: auth(alice), body: { invitee: "user_bob" }, requestId: "grant_create" } as never);
  const invitationId = String(created.body.data.invite_id);
  const accepted = await app.app.handle({
    method: "POST",
    path: `/api/v1/frogsleep/buddy/invitations/${invitationId}/accept`,
    headers: auth(bob),
    body: { expected_version: 1, idempotency_key: "grant_accept", sharing_categories: ["presence"] },
    requestId: "grant_accept",
  } as never);
  const relationshipId = String(accepted.body.data.results[0].relationship_id);

  const aliceGrants = await app.app.handle({ method: "GET", path: `/api/v1/frogsleep/buddy/relationships/${relationshipId}/grants`, headers: auth(alice), requestId: "alice_grants" } as never);
  const bobGrants = await app.app.handle({ method: "GET", path: `/api/v1/frogsleep/buddy/relationships/${relationshipId}/grants`, headers: auth(bob), requestId: "bob_grants" } as never);
  assert.equal(aliceGrants.statusCode, 200);
  assert.equal(bobGrants.statusCode, 200);
  assert.deepEqual(aliceGrants.body.data.grants.map((item: any) => [item.grantor_user_id, item.grantee_user_id, item.category]), [
    ["user_alice", "user_bob", "daily_summary"],
    ["user_alice", "user_bob", "presence"],
    ["user_bob", "user_alice", "daily_summary"],
    ["user_bob", "user_alice", "presence"],
  ]);
  assert.equal(aliceGrants.body.data.grants.find((item: any) => item.grantor_user_id === "user_bob" && item.category === "daily_summary").state, "revoked");
});

test("directional grant updates require participant authorization and expected version", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/focus-buddy/invites", headers: auth(alice), body: { target: "user_bob" }, requestId: "grant_update_create" } as never);
  const stored = await app.database.findFrogSleepEntityByCode("focus_invite", "frogsleep", String(created.body.data.invite_code));
  const accepted = await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/buddy/invitations/${stored!.id}/accept`, headers: auth(bob), body: { expected_version: 1, idempotency_key: "grant_update_accept", sharing_categories: ["presence"] }, requestId: "grant_update_accept" } as never);
  const relationshipId = String(accepted.body.data.results[0].relationship_id);
  const listed = await app.app.handle({ method: "GET", path: `/api/v1/frogsleep/buddy/relationships/${relationshipId}/grants`, headers: auth(bob), requestId: "grant_update_list" } as never);
  const ownGrant = listed.body.data.grants.find((item: any) => item.grantor_user_id === "user_bob");

  const stale = await app.app.handle({ method: "PATCH", path: `/api/v1/frogsleep/buddy/relationships/${relationshipId}/grants/${ownGrant.id}`, headers: auth(bob), body: { state: "revoked", expected_version: 9 }, requestId: "grant_stale" } as never);
  assert.equal(stale.statusCode, 409);
  const updated = await app.app.handle({ method: "PATCH", path: `/api/v1/frogsleep/buddy/relationships/${relationshipId}/grants/${ownGrant.id}`, headers: auth(bob), body: { state: "revoked", expected_version: 1 }, requestId: "grant_update" } as never);
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.data.state, "revoked");
  assert.equal(updated.body.data.version, 2);
  assert.equal(app.database.auditLogs.some((item) => item.action === "buddy_grant_updated" && item.resourceId === ownGrant.id), true);

  const forbiddenUpdate = await app.app.handle({ method: "PATCH", path: `/api/v1/frogsleep/buddy/relationships/${relationshipId}/grants/${ownGrant.id}`, headers: auth(alice), body: { state: "granted", expected_version: 2 }, requestId: "grant_forbidden" } as never);
  assert.equal(forbiddenUpdate.statusCode, 403);
});

test("bundled invitation accepts both domain relationships idempotently", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/invitations", headers: auth(alice), body: { target: "user_bob", domains: ["sleep", "focus"] }, requestId: "bundle_create" } as never);
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.data.domain, "bundle");
  assert.deepEqual(created.body.data.domains, ["sleep", "focus"]);
  assert.equal(String(created.body.data.share_link).startsWith("frogsleep://buddy-invitation?mode=preview"), true);
  const bundleId = String(created.body.data.invitation_id);
  assert.equal(app.database.frogSleepBuddyNotificationOutbox.filter((item) => item.eventType === "invitation_created").length, 1);

  const inbox = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/invitations", query: { direction: "incoming" }, headers: auth(bob), requestId: "bundle_inbox" } as never);
  assert.equal(inbox.body.data.invitations.length, 1);
  assert.equal(inbox.body.data.invitations[0].invitation_id, bundleId);
  const preview = await app.app.handle({ method: "GET", path: `/api/v1/frogsleep/buddy/invitations/${bundleId}`, headers: auth(bob), requestId: "bundle_preview" } as never);
  assert.equal(preview.body.data.viewer_can_accept, true);
  assert.deepEqual(preview.body.data.domain_error_codes, {});

  const request = { expected_version: 1, idempotency_key: "bundle_accept", sharing_categories: ["presence"] };
  const accepted = await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/buddy/invitations/${bundleId}/accept`, headers: auth(bob), body: request, requestId: "bundle_accept" } as never);
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(accepted.body.data.results.map((item: any) => item.status), ["accepted", "accepted"]);
  const replay = await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/buddy/invitations/${bundleId}/accept`, headers: auth(bob), body: request, requestId: "bundle_replay" } as never);
  assert.deepEqual(replay.body.data, accepted.body.data);
  assert.equal(app.database.frogSleepBuddyNotificationOutbox.filter((item) => item.targetId === bundleId && item.eventType === "invitation_accepted").length, 1);
});

test("bundled invitation exposes one-domain conflict and accepts eligible domain", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const focus = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/focus-buddy/invites", headers: auth(alice), body: { target: "user_bob" }, requestId: "existing_focus" } as never);
  const existingAccepted = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/focus-buddy/invites/accept-code", headers: auth(bob), body: { code: focus.body.data.invite_code }, requestId: "existing_focus_accept" } as never);

  const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/invitations", headers: auth(alice), body: { target: "user_bob", domains: ["sleep", "focus"] }, requestId: "partial_bundle_create" } as never);
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.data.domain_error_codes.focus, "REQ_INVALID_BODY");
  assert.ok(created.body.data.domain_invitation_ids.sleep);
  const accepted = await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/buddy/invitations/${created.body.data.invitation_id}/accept`, headers: auth(bob), body: { expected_version: 1, idempotency_key: "partial_accept", sharing_categories: ["presence"] }, requestId: "partial_accept" } as never);
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.data.results.find((item: any) => item.domain === "sleep").status, "accepted");
  assert.equal(accepted.body.data.results.find((item: any) => item.domain === "focus").error_code, "REQ_INVALID_BODY");

  await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/focus-buddy/relationships/${existingAccepted.body.data.relationship_id}/revoke`, headers: auth(bob), body: {}, requestId: "existing_focus_revoke" } as never);
  const recovered = await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/buddy/invitations/${created.body.data.invitation_id}/accept`, headers: auth(bob), body: { expected_version: 2, idempotency_key: "partial_retry", sharing_categories: ["presence"] }, requestId: "partial_retry" } as never);
  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.body.data.results.find((item: any) => item.domain === "focus").status, "accepted");
  assert.equal(recovered.body.data.results.every((item: any) => item.error_code == null), true);
});

test("buddy notification worker materializes one safe feed item and read APIs are viewer scoped", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites", headers: auth(alice), body: { invitee: "user_bob" }, requestId: "notification_create" } as never);
  const result = await app.services.buddyNotificationWorkerService.processBatch();
  assert.equal(result.processed, 1);
  assert.equal((await app.services.buddyNotificationWorkerService.processBatch()).processed, 0);
  assert.equal(app.database.frogSleepBuddyNotifications.length, 1);
  assert.equal(app.database.frogSleepBuddyNotificationDeliveries.filter((item) => item.channel === "in_app").length, 1);
  const notificationId = app.database.frogSleepBuddyNotifications[0]!.id;

  const feed = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/notifications", headers: auth(bob), requestId: "notification_feed" } as never);
  assert.equal(feed.statusCode, 200);
  assert.equal(feed.body.data.notifications[0].id, notificationId);
  assert.deepEqual(Object.keys(feed.body.data.notifications[0].route).sort(), ["domain", "invitation_id", "type"]);
  assert.equal(JSON.stringify(feed.body.data).includes(String(created.body.data.invite_token)), false);
  const unread = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/notifications/unread-count", headers: auth(bob), requestId: "notification_unread" } as never);
  assert.equal(unread.body.data.unread_count, 1);
  const route = await app.app.handle({ method: "GET", path: `/api/v1/frogsleep/buddy/notifications/${notificationId}/route`, headers: auth(bob), requestId: "notification_route" } as never);
  assert.equal(route.body.data.route.invitation_id, created.body.data.invite_id);
  const forbidden = await app.app.handle({ method: "GET", path: `/api/v1/frogsleep/buddy/notifications/${notificationId}/route`, headers: auth(alice), requestId: "notification_wrong_viewer" } as never);
  assert.equal(forbidden.statusCode, 404);
  await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/buddy/notifications/${notificationId}/read`, headers: auth(bob), body: {}, requestId: "notification_read" } as never);
  const afterRead = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/notifications/unread-count", headers: auth(bob), requestId: "notification_after_read" } as never);
  assert.equal(afterRead.body.data.unread_count, 0);
});

test("buddy notification worker keeps in-app delivery while Push capability is disabled", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  await login(app, "bob@example.com");
  await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites", headers: auth(alice),
    body: { invitee: "user_bob" }, requestId: "notification_push_disabled" } as never);
  const worker = new BuddyNotificationWorkerService(app.database, app.services.notificationService, undefined, false);

  assert.equal((await worker.processBatch()).processed, 1);
  assert.equal(app.database.frogSleepBuddyNotifications.length, 1);
  assert.equal(app.database.frogSleepBuddyNotificationDeliveries.some((item) =>
    item.channel === "apns" && item.status === "suppressed" && item.errorCode === "CAPABILITY_DISABLED"), true);
});

test("buddy notification worker suppresses expired, revoked, and blocked invitation targets", async () => {
  for (const scenario of ["expired", "revoked", "blocked"] as const) {
    const app = await runtime();
    const alice = await login(app, "alice@example.com");
    await login(app, "bob@example.com");
    const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites",
      headers: auth(alice), body: { invitee: "user_bob" }, requestId: `worker_${scenario}_create` } as never);
    const inviteId = String(created.body.data.invite_id);
    if (scenario === "expired") {
      await app.database.updateFrogSleepEntity("sleep_invite", "frogsleep", inviteId, { status: "expired" });
    } else if (scenario === "revoked") {
      app.database.frogSleepEntities = app.database.frogSleepEntities.filter((item) => item.id !== inviteId);
    } else {
      const now = new Date().toISOString();
      await app.database.insertFrogSleepEntity({ id: "worker_block", appId: "frogsleep",
        kind: "focus_match_feedback", ownerUserId: "user_bob", partnerUserId: "user_alice",
        status: "blocked", payload: {}, createdAt: now, updatedAt: now });
    }
    const result = await app.services.buddyNotificationWorkerService.processBatch();
    assert.equal(result.processed, 1);
    const outbox = app.database.frogSleepBuddyNotificationOutbox.find((item) => item.targetId === inviteId);
    assert.equal(outbox?.status, "dead_letter");
    const expected = scenario === "expired" ? "TARGET_EXPIRED"
      : scenario === "revoked" ? "TARGET_REVOKED" : "TARGET_BLOCKED";
    assert.equal(outbox?.lastErrorCode, expected);
    assert.equal(app.database.frogSleepBuddyNotifications.length, 0);
  }
});

test("buddy notification worker retries transient delivery and exposes dead letters", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  await app.app.handle({ method: "PATCH", path: "/api/v1/frogsleep/buddy/notifications/preferences",
    headers: auth(bob), body: { quiet_start_minute: 1, quiet_end_minute: 1,
      cooldown_minutes: 0, daily_budget: 100 }, requestId: "worker_retry_preferences" } as never);
  const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: auth(alice), body: { invitee: "user_bob" }, requestId: "worker_retry_create" } as never);
  app.services.notificationService.queueNotification = async () => ({ queued: false });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await app.services.buddyNotificationWorkerService.processBatch();
  }
  const outbox = app.database.frogSleepBuddyNotificationOutbox.find((item) =>
    item.targetId === String(created.body.data.invite_id));
  assert.equal(outbox?.status, "dead_letter");
  assert.equal(outbox?.attemptCount, 5);
  assert.equal(outbox?.lastErrorCode, "DELIVERY_FAILED");
  assert.equal(app.database.frogSleepBuddyNotifications.length, 1);
});

test("buddy notification preferences suppress disabled categories", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const defaults = await app.app.handle({ method: "GET",
    path: "/api/v1/frogsleep/buddy/notifications/preferences", headers: auth(bob),
    requestId: "preference_defaults" } as never);
  assert.equal(defaults.body.data.daily_budget, 8);
  const updated = await app.app.handle({ method: "PATCH",
    path: "/api/v1/frogsleep/buddy/notifications/preferences", headers: auth(bob),
    body: { disabled_categories: ["invitations"] }, requestId: "preference_disable" } as never);
  assert.deepEqual(updated.body.data.disabled_categories, ["invitations"]);
  await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: auth(alice), body: { invitee: "user_bob" }, requestId: "preference_invite" } as never);
  await app.services.buddyNotificationWorkerService.processBatch();
  assert.equal(app.database.frogSleepBuddyNotifications.length, 0);
  assert.equal(app.database.frogSleepBuddyNotificationOutbox[0]?.lastErrorCode, "PREFERENCE_DISABLED");
});

test("quiet hours and daily budgets preserve feed while suppressing Push", async () => {
  for (const scenario of ["quiet", "budget"] as const) {
    const app = await runtime();
    const alice = await login(app, "alice@example.com");
    const bob = await login(app, "bob@example.com");
    const body = scenario === "quiet"
      ? { quiet_start_minute: 0, quiet_end_minute: 1439 }
      : { daily_budget: 0, quiet_start_minute: 1, quiet_end_minute: 1 };
    await app.app.handle({ method: "PATCH", path: "/api/v1/frogsleep/buddy/notifications/preferences",
      headers: auth(bob), body, requestId: `preference_${scenario}` } as never);
    await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites",
      headers: auth(alice), body: { invitee: "user_bob" }, requestId: `${scenario}_invite` } as never);
    await app.services.buddyNotificationWorkerService.processBatch();
    assert.equal(app.database.frogSleepBuddyNotifications.length, 1);
    const apns = app.database.frogSleepBuddyNotificationDeliveries.find((item) => item.channel === "apns");
    assert.equal(apns?.status, "suppressed");
    assert.equal(apns?.errorCode, scenario === "quiet" ? "QUIET_HOURS" : "DAILY_BUDGET");
  }
});

test("notification worker coalesces duplicate events and cools down same-category Push", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  await app.app.handle({ method: "PATCH", path: "/api/v1/frogsleep/buddy/notifications/preferences",
    headers: auth(bob), body: { quiet_start_minute: 1, quiet_end_minute: 1,
      cooldown_minutes: 30, daily_budget: 100 }, requestId: "coalesce_preferences" } as never);
  const sleep = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: auth(alice), body: { invitee: "user_bob" }, requestId: "coalesce_sleep" } as never);
  await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/focus-buddy/invites",
    headers: auth(alice), body: { target: "user_bob" }, requestId: "coalesce_focus" } as never);
  await app.services.buddyNotificationWorkerService.processBatch();
  assert.equal(app.database.frogSleepBuddyNotifications.length, 2);
  assert.equal(app.database.frogSleepBuddyNotificationDeliveries.some((item) =>
    item.channel === "apns" && item.errorCode === "CATEGORY_COOLDOWN"), true);
  const now = new Date().toISOString();
  await app.database.enqueueFrogSleepBuddyNotificationOutbox({ id: "duplicate_outbox", appId: "frogsleep",
    recipientUserId: "user_bob", eventType: "invitation_created", targetType: "buddy_invitation",
    targetId: String(sleep.body.data.invite_id), deduplicationKey: "duplicate-logical-event",
    safeRoute: { type: "buddy_invitation", invitation_id: String(sleep.body.data.invite_id), domain: "sleep" },
    status: "pending", attemptCount: 0, availableAt: now, createdAt: now, updatedAt: now });
  await app.services.buddyNotificationWorkerService.processBatch();
  assert.equal(app.database.frogSleepBuddyNotifications.length, 2);
  assert.equal(app.database.frogSleepBuddyNotificationOutbox.find((item) =>
    item.id === "duplicate_outbox")?.lastErrorCode, "EVENT_COALESCED");
});
