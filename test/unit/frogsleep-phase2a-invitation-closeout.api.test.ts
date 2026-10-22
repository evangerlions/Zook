import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
async function runtime() {
  return createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed) });
}
type Runtime = Awaited<ReturnType<typeof runtime>>;
async function request(app: Runtime, token: string, method: string, path: string, body?: unknown, query?: unknown) {
  return app.app.handle({ method, path, headers: { authorization: `Bearer ${token}` }, body, query,
    requestId: `closeout_${method}_${path}` } as never);
}
async function login(app: Runtime, account: string) {
  const response = await request(app, "", "POST", "/api/v1/frogsleep/auth/password/login", { account, password: "Password1234" });
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}
async function create(app: Runtime, alice: string, email = "future@example.com") {
  const response = await request(app, alice, "POST", "/api/v1/frogsleep/buddy/invitations",
    { target: { email }, domains: ["sleep", "focus"] });
  assert.equal(response.statusCode, 200);
  return response.body.data;
}
const path = (id: string) => `/api/v1/frogsleep/buddy/invitations/${id}`;
async function decide(app: Runtime, token: string, id: string, domain: string, action: string, key: string, version = 1) {
  return request(app, token, "POST", `${path(id)}/domains/${domain}/${action}`,
    { expected_version: version, idempotency_key: key });
}

test("email handoff hides wrong-account details, resumes after login and preserves independent domain truth", async () => {
  const app = await runtime(); const alice = await login(app, "alice@example.com");
  const oldBob = await login(app, "bob@example.com"); const invitation = await create(app, alice);
  const id = String(invitation.invitation_id);
  const hidden = await request(app, oldBob, "GET", "/api/v1/frogsleep/buddy/invitations/preview",
    undefined, { token: new URL(invitation.share_link).searchParams.get("token") });
  assert.equal(hidden.statusCode, 404);
  assert.equal(JSON.stringify(hidden.body).includes("alice"), false);
  assert.equal((await decide(app, oldBob, id, "sleep", "accept", "wrong")).statusCode, 404);
  assert.equal((await app.database.findFrogSleepBuddyInvitationBundle("frogsleep", id))?.inviteeUserId, undefined);
  await app.database.updateUserEmail("user_bob", "future@example.com");
  const bob = await login(app, "future@example.com");
  const preview = await request(app, bob, "GET", "/api/v1/frogsleep/buddy/invitations/preview",
    undefined, { code: ` ${String(invitation.share_code).toLowerCase()} ` });
  assert.equal(preview.statusCode, 200);
  assert.deepEqual(preview.body.data.domain_results.map((r: any) => [r.domain, r.status, r.decision_version]),
    [["sleep", "pending", 1], ["focus", "pending", 1]]);
  assert.equal(app.database.frogSleepBuddyDomainRelationships.length, 0);
  const sleep = await decide(app, bob, id, "sleep", "accept", "sleep-first");
  assert.equal(sleep.statusCode, 200);
  assert.equal((await app.database.findFrogSleepBuddyInvitationBundle("frogsleep", id))?.inviteeUserId, "user_bob");
  const partial = await request(app, bob, "GET", path(id));
  assert.deepEqual(partial.body.data.domain_results.map((r: any) => [r.status, r.decision_version]), [["accepted", 2], ["pending", 1]]);
  assert.equal(partial.body.data.domain_results[0].relationship_id, sleep.body.data.relationship_id);
  const focus = await decide(app, bob, id, "focus", "decline", "focus-decline");
  assert.equal(focus.statusCode, 200);
  const replay = await decide(app, bob, id, "sleep", "accept", "sleep-first");
  assert.deepEqual(replay.body.data, sleep.body.data);
  assert.equal((await decide(app, bob, id, "sleep", "accept", "sleep-first", 2)).statusCode, 409);
  assert.equal((await decide(app, bob, id, "focus", "decline", "focus-decline")).statusCode, 200);
  assert.equal((await decide(app, alice, id, "sleep", "accept", "sleep-first")).statusCode, 404);
  const finished = await request(app, bob, "GET", path(id));
  assert.deepEqual(finished.body.data.domain_results.map((r: any) => r.status), ["accepted", "declined"]);
  assert.deepEqual(finished.body.data.viewer_actions, ["preview"]);
  assert.equal(finished.body.data.viewer_can_accept, false);
  assert.deepEqual((await request(app, alice, "GET", path(id))).body.data.viewer_actions, ["preview"]);
  assert.equal(app.database.frogSleepBuddyDomainRelationships.length, 1);
  assert.ok(app.database.frogSleepBuddySharingGrants.every(grant => grant.state === "revoked"));
  assert.equal(app.database.frogSleepBuddyNotificationOutbox.filter((r) => r.targetId === id).length, 2);
});

test("unregistered-recipient cancel and late-recipient decline are replayable without creating slots", async () => {
  const app = await runtime(); const alice = await login(app, "alice@example.com");
  const invitation = await create(app, alice); const id = String(invitation.invitation_id);
  const cancel = await decide(app, alice, id, "sleep", "cancel", "cancel-once");
  assert.equal(cancel.statusCode, 200);
  assert.deepEqual((await decide(app, alice, id, "sleep", "cancel", "cancel-once")).body.data, cancel.body.data);
  assert.equal((await decide(app, alice, id, "sleep", "cancel", "another-key")).statusCode, 409);
  await app.database.updateUserEmail("user_bob", "future@example.com"); const bob = await login(app, "future@example.com");
  const decline = await decide(app, bob, id, "focus", "decline", "decline-once");
  assert.equal(decline.statusCode, 200);
  assert.deepEqual((await decide(app, bob, id, "focus", "decline", "decline-once")).body.data, decline.body.data);
  assert.equal(app.database.frogSleepBuddyDomainRelationships.length, 0);
  assert.equal(app.database.frogSleepBuddyDomainSlots.length, 0);
});

test("concurrent accept/cancel decides once, and a terminal sibling cannot be changed by aggregate commands", async () => {
  const app = await runtime(); const alice = await login(app, "alice@example.com"); const bob = await login(app, "bob@example.com");
  const invitation = await create(app, alice, "bob@example.com"); const id = String(invitation.invitation_id);
  const replies = await Promise.all([decide(app, bob, id, "sleep", "accept", "accept-race"),
    decide(app, alice, id, "sleep", "cancel", "cancel-race")]);
  assert.deepEqual(replies.map((r) => r.statusCode).sort(), [200, 409]);
  const winner = replies.find((r) => r.statusCode === 200)!;
  const action = winner.body.data.decision_status === "accepted" ? "accept" : "cancel";
  const token = action === "accept" ? bob : alice;
  assert.deepEqual((await decide(app, token, id, "sleep", action, `${action}-race`)).body.data, winner.body.data);
  const aggregate = await request(app, bob, "POST", `${path(id)}/accept`, { expected_version: 1, idempotency_key: "aggregate" });
  assert.equal(aggregate.statusCode, 409);
  assert.equal((await app.database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", id, "focus"))?.status, "pending");
  assert.ok(app.database.frogSleepBuddySharingGrants.every(grant => grant.state === "revoked"));
});

test("accept replay returns the original receipt after slot changes and refuses same-key version changes", async () => {
  const app = await runtime(); const alice = await login(app, "alice@example.com"); const bob = await login(app, "bob@example.com");
  const invitation = await create(app, alice, "bob@example.com"); const id = String(invitation.invitation_id);
  const accepted = await decide(app, bob, id, "focus", "accept", "receipt"); assert.equal(accepted.statusCode, 200);
  const originalId = String(accepted.body.data.relationship_id);
  const original = await app.database.findFrogSleepBuddyDomainRelationship("frogsleep", originalId);
  await app.database.compareAndUpdateFrogSleepBuddyDomainRelationship({ appId: "frogsleep", id: originalId,
    expectedVersion: original!.version, status: "revoked", pausedByUserIds: [], revokedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const slot = await app.database.findFrogSleepBuddyDomainSlot("frogsleep", "user_bob", "focus");
  await app.database.compareAndUpdateFrogSleepBuddyDomainSlot({ appId: "frogsleep", userId: "user_bob", domain: "focus",
    expectedVersion: slot!.version, state: "available", updatedAt: new Date().toISOString() });
  const replay = await decide(app, bob, id, "focus", "accept", "receipt");
  assert.equal(replay.statusCode, 200); assert.equal(replay.body.data.relationship_id, originalId);
  assert.equal(replay.body.data.relationship_status, "revoked");
  assert.equal((await decide(app, bob, id, "focus", "accept", "receipt", 10)).statusCode, 409);
  assert.equal(app.database.frogSleepBuddyDomainRelationships.length, 1);
});

test("compatibility accept replays without duplicate grants and rejects inviter replay of the recipients action", async () => {
  const app = await runtime(); const alice = await login(app, "alice@example.com"); const bob = await login(app, "bob@example.com");
  const invitation = await create(app, alice, "bob@example.com"); const id = String(invitation.invitation_id);
  const body = { expected_version: 1, idempotency_key: "legacy", sharing_categories: ["presence"] };
  const accepted = await request(app, bob, "POST", `${path(id)}/accept`, body);
  assert.equal(accepted.statusCode, 200);
  const grantCount = app.database.frogSleepBuddySharingGrants.length;
  const eventCount = app.database.frogSleepBuddyNotificationOutbox.length;
  const replay = await request(app, bob, "POST", `${path(id)}/accept`, body);
  assert.deepEqual(replay.body.data, accepted.body.data);
  assert.equal(app.database.frogSleepBuddySharingGrants.length, grantCount);
  assert.equal(app.database.frogSleepBuddyNotificationOutbox.length, eventCount);
  assert.equal((await request(app, alice, "POST", `${path(id)}/accept`, body)).statusCode, 403);
  const bundle = await app.database.findFrogSleepBuddyInvitationBundle("frogsleep", id);
  const child = String(bundle?.domainInvitationIds.sleep);
  const actorReplay = await request(app, alice, "POST", `${path(child)}/accept`, { ...body, idempotency_key: "legacy:sleep" });
  assert.equal(actorReplay.statusCode, 403);
  assert.equal((await decide(app, bob, id, "sleep", "accept", "new-key")).statusCode, 409);
});
