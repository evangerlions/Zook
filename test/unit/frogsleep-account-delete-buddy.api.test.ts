import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { BuddyDomainInvitationCommandService } from "../../src/modules/frogsleep/buddy-growth/buddy-domain-invitation-command.service.ts";

async function fixture() {
  const runtime = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  const response = await runtime.app.handle({ method: "POST", path: "/api/v1/frogsleep/auth/password/login",
    headers: {}, body: { account: "alice@example.com", password: "Password1234" } } as never);
  assert.equal(response.statusCode, 200);
  const token = String(response.body.data.access_token);
  const now = new Date().toISOString();
  runtime.database.upsertFrogSleepBuddyInvitationBundle({ id: "delete-bundle", appId: "frogsleep",
    inviterUserId: "user_alice", inviteeUserId: "user_bob", domains: ["sleep", "focus"],
    status: "pending", version: 1, expiresAt: new Date(Date.now() + 86400000).toISOString(),
    shareCode: "DELETE01", handoffToken: "delete-token", shareLink: "https://example.com/invite",
    locale: "en", domainInvitationIds: {}, domainErrorCodes: {}, createdAt: now, updatedAt: now });
  for (const domain of ["sleep", "focus"] as const) runtime.database.upsertFrogSleepBuddyInvitationDomainDecision({
    appId: "frogsleep", invitationId: "delete-bundle", domain, status: "pending", version: 1,
    createdAt: now, updatedAt: now });
  const original = runtime.database.findFrogSleepBuddyInvitationBundle("frogsleep", "delete-bundle")!;
  runtime.database.upsertFrogSleepBuddyInvitationBundle({ ...original, id: "email-only-bundle",
    inviterUserId: "user_bob", inviteeUserId: undefined, recipientEmail: "alice@example.com",
    shareCode: "EMAILONLY", handoffToken: "email-only-token" });
  const commands = new BuddyDomainInvitationCommandService(runtime.database);
  const accepted = await commands.accept("user_bob", "delete-bundle", "sleep", {
    expectedVersion: 1, idempotencyKey: "delete-accept" });
  async function remove() {
    return await runtime.app.handle({ method: "DELETE", path: "/api/v1/frogsleep/me/account",
      headers: { authorization: `Bearer ${token}` } } as never);
  }
  return { runtime, commands, accepted, remove, token };
}

test("FrogSleep deletion removes normalized relationships, grants, decisions and counterpart notification targets", async () => {
  const { runtime, commands, accepted, remove } = await fixture();
  const db = runtime.database;
  const now = new Date().toISOString();
  db.notificationJobs.push({ id: "partner-job", appId: "frogsleep", recipientUserId: "user_bob",
    channel: "email", status: "PENDING", retryCount: 0, payload: { relationshipId: accepted.relationship_id } });
  db.notificationJobs.push({ id: "other-product", appId: "app_a", recipientUserId: "user_alice",
    channel: "email", status: "PENDING", retryCount: 0, payload: {} });
  db.frogSleepBuddyNotificationOutbox.push({ id: "partner-outbox", appId: "frogsleep",
    recipientUserId: "user_bob", targetType: "invitation", targetId: "delete-bundle", eventType: "invitation_received",
    deduplicationKey: "delete-outbox", safeRoute: {}, status: "pending", attemptCount: 0,
    availableAt: now, createdAt: now, updatedAt: now });
  const response = await remove();
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(db.findUserById("user_alice")?.status, "ACTIVE");
  assert.equal(db.findAppUser("frogsleep", "user_alice")?.status, "DELETED");
  assert.equal(db.findAppUser("app_a", "user_alice")?.status, "ACTIVE");
  assert.equal(db.frogSleepBuddyDomainRelationships.length, 0);
  assert.equal(db.frogSleepBuddySharingGrants.length, 0);
  assert.equal(db.frogSleepBuddyInvitationDomainDecisions.length, 0);
  assert.equal(db.frogSleepBuddyInvitationBundles.length, 0);
  assert.equal(db.frogSleepBuddyNotificationOutbox.length, 0);
  assert.equal(db.frogSleepBuddyDomainSlots.some(item => item.userId === "user_alice"), false);
  assert.equal(db.findFrogSleepBuddyDomainSlot("frogsleep", "user_bob", "sleep")?.state, "available");
  assert.equal(db.notificationJobs.some(item => item.id === "partner-job"), false);
  assert.equal(db.notificationJobs.some(item => item.id === "other-product"), true);
  await assert.rejects(commands.accept("user_bob", "delete-bundle", "sleep",
    { expectedVersion: 1, idempotencyKey: "delete-accept" }));
  assert.equal((await remove()).statusCode, 401);
});

test("FrogSleep deletion waits for a pending domain command and cleans its final committed relationship", async () => {
  const { runtime, commands, remove } = await fixture();
  let entered!: () => void; let release!: () => void;
  const enteredPromise = new Promise<void>(done => { entered = done; });
  const releasePromise = new Promise<void>(done => { release = done; });
  const database = runtime.database;
  const work = database.withFrogSleepBuddyCommandTransaction([
    { appId: "frogsleep", userId: "user_alice", domain: "focus" },
    { appId: "frogsleep", userId: "user_bob", domain: "focus" },
  ], async () => {
    entered(); await releasePromise;
    return await commands.accept("user_bob", "delete-bundle", "focus", { expectedVersion: 1, idempotencyKey: "focus-late" });
  });
  await enteredPromise;
  const deletion = remove();
  release();
  assert.equal((await work).relationship_status, "active");
  assert.equal((await deletion).statusCode, 200);
  assert.equal(database.frogSleepBuddyDomainRelationships.length, 0);
  assert.equal(database.frogSleepBuddySharingGrants.length, 0);
});
