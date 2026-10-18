import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
type Runtime = Awaited<ReturnType<typeof createApplication>>;
type Domain = "focus" | "sleep";

async function request(app: Runtime, token: string, method: string, path: string, body?: unknown) {
  return await app.app.handle({ method, path: `/api/v1/frogsleep${path}`, body,
    headers: { authorization: `Bearer ${token}` }, requestId: "legacy_shadow" } as never);
}

async function fixture(domain: Domain) {
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  const tokens: string[] = [];
  for (const account of ["alice@example.com", "bob@example.com"]) {
    const login = await request(app, "", "POST", "/auth/password/login", { account, password: "Password1234" });
    assert.equal(login.statusCode, 200);
    tokens.push(String(login.body.data.access_token));
  }
  const [alice, bob] = tokens;
  const invitation = await request(app, alice, "POST", "/buddy/invitations", {
    target: { email: "bob@example.com" }, domains: [domain] });
  assert.equal(invitation.statusCode, 200);
  const accepted = await request(app, bob, "POST", `/buddy/invitations/${invitation.body.data.invitation_id}/domains/${domain}/accept`,
    { expected_version: 1, idempotency_key: `shadow_accept_${domain}` });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  const relationshipId = String(accepted.body.data.relationship_id);
  const legacyId = await insertLegacy(app, domain, `legacy_shadow_${domain}`);
  return { app, alice, bob, relationshipId, legacyId };
}

async function insertLegacy(app: Runtime, domain: Domain, id: string) {
  const kind = domain === "focus" ? "focus_relationship" : "sleep_relationship";
  const existing = (await app.database.listFrogSleepEntities({ appId: "frogsleep", kind,
    ownerUserId: "user_alice", partnerUserId: "user_bob", limit: 100 }))[0];
  if (existing) {
    await app.database.updateFrogSleepEntity(kind, "frogsleep", existing.id, {
      status: domain === "focus" ? "accepted" : "active" });
    return existing.id;
  }
  const beforeCanonical = new Date(Date.now() - 86_400_000).toISOString();
  await app.database.insertFrogSleepEntity({ id, appId: "frogsleep",
    kind,
    ownerUserId: "user_alice", partnerUserId: "user_bob", status: domain === "focus" ? "accepted" : "active",
    payload: {}, createdAt: beforeCanonical, updatedAt: beforeCanonical });
  return id;
}

for (const domain of ["focus", "sleep"] as const) {
  test(`revoked canonical ${domain} relationship cannot resurrect its active legacy shadow`, async () => {
    const f = await fixture(domain);
    const currentPath = `/${domain}-buddy/relationships/current`;
    const before = await request(f.app, f.alice, "GET", currentPath);
    assert.equal(before.statusCode, 200);
    assert.equal(before.body.data.relationship.relationship_id, f.relationshipId);
    const revoked = await request(f.app, f.alice, "POST", `/${domain}-buddy/relationships/${f.relationshipId}/revoke`);
    assert.equal(revoked.statusCode, 200, JSON.stringify(revoked.body));
    for (const token of [f.alice, f.bob]) {
      const hub = await request(f.app, token, "GET", "/buddy/hub");
      assert.equal(hub.statusCode, 200, JSON.stringify(hub.body));
      const ids = hub.body.data.partners.flatMap((partner: any) =>
        partner.relationships.map((relationship: any) => relationship.relationship_id));
      assert.equal(ids.includes(f.legacyId), false, "revocation must retain canonical precedence over legacy data");
      const current = await request(f.app, token, "GET", currentPath);
      assert.equal(current.statusCode, 200, JSON.stringify(current.body));
      assert.equal(current.body.data.relationship, null);
    }
  });
}

test("revoking canonical focus does not hide the same person's independent legacy sleep relationship", async () => {
  const f = await fixture("focus");
  await insertLegacy(f.app, "sleep", "independent_legacy_sleep");
  const revoked = await request(f.app, f.alice, "POST", `/focus-buddy/relationships/${f.relationshipId}/revoke`);
  assert.equal(revoked.statusCode, 200);
  const current = await request(f.app, f.alice, "GET", "/sleep-buddy/relationships/current");
  assert.equal(current.statusCode, 200);
  assert.equal(current.body.data.relationship.relationship_id, "independent_legacy_sleep");
});
