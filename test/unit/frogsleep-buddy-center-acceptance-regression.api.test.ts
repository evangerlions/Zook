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
const invitationPath = (id: string) => `/api/v1/frogsleep/buddy/invitations/${id}`;

async function request(app: Runtime, token: string, method: string, path: string, body?: unknown, query?: unknown) {
  return app.app.handle({ method, path, body, query, headers: { authorization: `Bearer ${token}` },
    requestId: `acceptance_${method}_${path}` } as never);
}

async function login(app: Runtime, account: string) {
  const response = await request(app, "", "POST", "/api/v1/frogsleep/auth/password/login",
    { account, password: "Password1234" });
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

async function create(app: Runtime, alice: string, domains: Array<"sleep" | "focus">) {
  const response = await request(app, alice, "POST", "/api/v1/frogsleep/buddy/invitations",
    { target: { email: "bob@example.com" }, domains });
  assert.equal(response.statusCode, 200);
  return String(response.body.data.invitation_id);
}

async function accept(app: Runtime, bob: string, id: string, domain: "sleep" | "focus") {
  const response = await request(app, bob, "POST", `${invitationPath(id)}/domains/${domain}/accept`,
    { expected_version: 1, idempotency_key: `acceptance_${id}_${domain}` });
  assert.equal(response.statusCode, 200);
  return response.body.data;
}

async function listed(app: Runtime, token: string, direction: "incoming" | "outgoing", id: string) {
  const response = await request(app, token, "GET", "/api/v1/frogsleep/buddy/invitations", undefined, { direction });
  assert.equal(response.statusCode, 200);
  const invitation = response.body.data.invitations.find((item: { invitation_id: string }) => item.invitation_id === id);
  assert.ok(invitation);
  return invitation;
}

test("accepting a single invitation domain updates both participants' list status to accepted", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const id = await create(app, alice, ["sleep"]);

  const receipt = await accept(app, bob, id, "sleep");

  for (const [token, direction] of [[bob, "incoming"], [alice, "outgoing"]] as const) {
    const invitation = await listed(app, token, direction, id);
    assert.equal(invitation.status, "accepted");
    assert.deepEqual(invitation.viewer_actions, ["preview"]);
    assert.equal(invitation.domain_results[0].relationship_id, receipt.relationship_id);
  }
});

test("a bundle retains its pending sibling after partial acceptance and becomes accepted after both domains accept", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const id = await create(app, alice, ["sleep", "focus"]);

  await accept(app, bob, id, "sleep");
  const partial = await listed(app, bob, "incoming", id);
  assert.equal(partial.status, "pending");
  assert.deepEqual(partial.domain_results.map((item: any) => [item.domain, item.status, item.viewer_actions]),
    [["sleep", "accepted", []], ["focus", "pending", ["accept", "decline"]]]);

  await accept(app, bob, id, "focus");

  const complete = await listed(app, bob, "incoming", id);
  assert.equal(complete.status, "accepted");
  assert.deepEqual(complete.viewer_actions, ["preview"]);
  assert.deepEqual(complete.domain_results.map((item: any) => item.status), ["accepted", "accepted"]);
});

test("previewing an incoming bundle clears its unread state in the next inbox response", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const id = await create(app, alice, ["sleep", "focus"]);
  assert.equal((await listed(app, bob, "incoming", id)).unread, true);

  const preview = await request(app, bob, "GET", invitationPath(id));

  assert.equal(preview.statusCode, 200);
  assert.equal((await listed(app, bob, "incoming", id)).unread, false);
});

test("a new bundle exposes an already connected same-pair domain as read-only while its other domain remains actionable", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const originalId = await create(app, alice, ["sleep"]);
  const existing = await accept(app, bob, originalId, "sleep");
  const nextId = await create(app, alice, ["sleep", "focus"]);

  const preview = await request(app, bob, "GET", invitationPath(nextId));

  assert.equal(preview.statusCode, 200);
  const sleep = preview.body.data.domain_results.find((item: any) => item.domain === "sleep");
  const focus = preview.body.data.domain_results.find((item: any) => item.domain === "focus");
  assert.equal(sleep.relationship_id, existing.relationship_id);
  assert.deepEqual(sleep.viewer_actions, []);
  assert.equal(focus.status, "pending");
  assert.deepEqual(focus.viewer_actions, ["accept", "decline"]);
  await accept(app, bob, nextId, "focus");
  assert.equal(app.database.frogSleepBuddyDomainRelationships.length, 2);
});


test("an already connected focus-only invitation is terminal without a failed child invitation", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const originalId = await create(app, alice, ["focus"]);
  const existing = await accept(app, bob, originalId, "focus");
  const nextId = await create(app, alice, ["focus"]);
  const preview = await request(app, bob, "GET", invitationPath(nextId));
  assert.equal(preview.body.data.status, "accepted");
  assert.equal(preview.body.data.viewer_can_accept, false);
  assert.equal(preview.body.data.domain_results[0].error_code, null);
  assert.equal(preview.body.data.domain_results[0].relationship_id, existing.relationship_id);
  const bundle = await app.database.findFrogSleepBuddyInvitationBundle("frogsleep", nextId);
  assert.deepEqual(bundle?.domainErrorCodes, {});
  assert.deepEqual(bundle?.domainInvitationIds, {});
  assert.equal(app.database.frogSleepBuddyDomainRelationships.length, 1);
});

test("a new decision marks a previously read invitation unread for the other participant", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const id = await create(app, alice, ["sleep"]);
  assert.equal((await listed(app, alice, "outgoing", id)).unread, false);
  await accept(app, bob, id, "sleep");
  assert.equal((await listed(app, alice, "outgoing", id)).unread, true);
  await request(app, alice, "GET", invitationPath(id));
  assert.equal((await listed(app, alice, "outgoing", id)).unread, false);
});
