import assert from "node:assert/strict";
import test from "node:test";
import {
  BuddyGrowthRepository,
  type BuddySharingGrantRecord,
  type BuddyInvitationReceiptRecord,
} from "../../src/modules/frogsleep/buddy-growth/buddy-growth-repository.ts";

function grant(id: string): BuddySharingGrantRecord {
  return {
    id,
    appId: "frogsleep",
    relationshipId: "relationship_1",
    grantorUserId: "user_alice",
    granteeUserId: "user_bob",
    domain: "sleep",
    category: "presence",
    state: "granted",
    version: 1,
    grantedAt: "2026-07-12T00:00:00.000Z",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
}

function receipt(id: string, createdAt: string): BuddyInvitationReceiptRecord {
  return {
    id,
    appId: "frogsleep",
    invitationKind: "sleep_invite",
    invitationId: id,
    inviterUserId: "user_alice",
    inviteeUserId: "user_bob",
    status: "pending",
    version: 1,
    expiresAt: "2026-07-20T00:00:00.000Z",
    createdAt,
    updatedAt: createdAt,
  };
}

test("in-memory buddy growth repository upserts a directional grant by canonical key", async () => {
  const repository = BuddyGrowthRepository.inMemory();
  await repository.upsertGrant(grant("grant_1"));
  await repository.upsertGrant({ ...grant("grant_2"), state: "revoked", version: 2 });

  const grants = await repository.listGrantsForViewer("frogsleep", "user_bob", "relationship_1");
  assert.equal(grants.length, 1);
  assert.equal(grants[0]?.id, "grant_1");
  assert.equal(grants[0]?.state, "revoked");
  assert.equal(grants[0]?.version, 2);
});

test("in-memory buddy growth repository paginates invitation inbox newest first", async () => {
  const repository = BuddyGrowthRepository.inMemory();
  await repository.upsertInvitationReceipt(receipt("invite_old", "2026-07-11T00:00:00.000Z"));
  await repository.upsertInvitationReceipt(receipt("invite_new", "2026-07-12T00:00:00.000Z"));

  const page = await repository.listInvitationInbox({ appId: "frogsleep", userId: "user_bob", limit: 1 });
  assert.deepEqual(page.items.map((item) => item.invitationId), ["invite_new"]);
  assert.equal(page.nextCursor, "2026-07-12T00:00:00.000Z|invite_new");
});

test("notification outbox deduplicates logical events", async () => {
  const repository = BuddyGrowthRepository.inMemory();
  const first = await repository.enqueueNotification({
    id: "outbox_1",
    appId: "frogsleep",
    recipientUserId: "user_bob",
    eventType: "invitation_received",
    targetType: "buddy_invitation",
    targetId: "invite_1",
    deduplicationKey: "invite_1:user_bob:created",
    safeRoute: { invitation_id: "invite_1" },
    status: "pending",
    attemptCount: 0,
    availableAt: "2026-07-12T00:00:00.000Z",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  });
  const duplicate = await repository.enqueueNotification({ ...first, id: "outbox_2" });

  assert.equal(duplicate.id, first.id);
  assert.equal((await repository.listReadyNotifications("2026-07-12T00:01:00.000Z", 10)).length, 1);
});

test("buddy invitation bundle stores child domain outcomes and viewer direction", async () => {
  const repository = BuddyGrowthRepository.inMemory();
  const now = new Date().toISOString();
  await repository.upsertBundle({
    id: "bundle_1", appId: "frogsleep", inviterUserId: "alice", inviteeUserId: "bob",
    status: "pending", domains: ["sleep", "focus"], version: 1,
    domainInvitationIds: { sleep: "sleep_1" }, domainErrorCodes: { focus: "RELATIONSHIP_CONFLICT" },
    expiresAt: now, createdAt: now, updatedAt: now,
  });
  const inbox = await repository.listBundles({ appId: "frogsleep", userId: "bob", direction: "incoming" });
  const outbox = await repository.listBundles({ appId: "frogsleep", userId: "alice", direction: "outgoing" });
  assert.equal(inbox[0]?.id, "bundle_1");
  assert.equal(outbox[0]?.domainInvitationIds.sleep, "sleep_1");
  assert.equal((await repository.findBundle("frogsleep", "bundle_1"))?.domainErrorCodes.focus, "RELATIONSHIP_CONFLICT");
});
