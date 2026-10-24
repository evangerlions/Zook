import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
type Runtime = Awaited<ReturnType<typeof createApplication>>;
type AcceptMode = "aggregate" | "per-domain";
const domains = ["sleep", "focus"] as const;
const postgresUrl = process.env.FROGSLEEP_REINVITE_TEST_DATABASE_URL?.trim();
let postgresRuntime: Promise<Runtime> | undefined;

after(async () => {
  if (postgresRuntime) await (await postgresRuntime).close();
});

async function runtime() {
  if (!postgresUrl) return createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: seed => new InMemoryDatabase(seed) });
  postgresRuntime ??= (async () => {
    const seed = buildDefaultSeed(new DevelopmentPasswordHasher(), { includeFrogSleep: true });
    const database = await PostgresDatabase.create(postgresUrl, seed);
    try {
      return await createApplication({ frogsleepEnabled: true, queueBackend: "memory", database });
    } catch (error) {
      await database.close();
      throw error;
    }
  })();
  return postgresRuntime;
}

async function request(app: Runtime, token: string, method: string, path: string, body?: unknown) {
  return app.app.handle({ method, path: `/api/v1/frogsleep${path}`, body,
    headers: { authorization: `Bearer ${token}` }, requestId: "canonical_reinvite_readonly" } as never);
}

async function create(app: Runtime, token: string, userId: string) {
  const response = await request(app, token, "POST", "/buddy/invitations", {
    target: { user_id: userId }, domains });
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  return response.body.data;
}

async function accept(app: Runtime, token: string, invitationId: string, mode: AcceptMode) {
  if (mode === "aggregate") {
    const response = await request(app, token, "POST", `/buddy/invitations/${invitationId}/accept`, {
      expected_version: 1, idempotency_key: `${invitationId}_aggregate`, sharing_categories: [] });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.ok(response.body.data.results.every((item: any) => item.status === "accepted" && !item.error_code),
      JSON.stringify(response.body.data));
    return response.body.data.results;
  }
  const results = [];
  for (const domain of domains) {
    const response = await request(app, token, "POST", `/buddy/invitations/${invitationId}/domains/${domain}/accept`, {
      expected_version: 1, idempotency_key: `${invitationId}_${domain}` });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    results.push({ domain, relationship_id: response.body.data.relationship_id });
  }
  return results;
}

async function actor(app: Runtime, name: string) {
  const id = `reinvite_${randomUUID().replaceAll("-", "")}_${name}`;
  await app.database.insertUser({ id, email: `${id}@example.test`, passwordHash: "unused", passwordAlgo: "test",
    status: "ACTIVE", createdAt: new Date().toISOString() });
  await app.services.appRegistryService.ensureMembership("frogsleep", id);
  return { id, token: (await app.services.authService.issueSession(id, "frogsleep")).accessToken };
}

async function fixture(mode: AcceptMode, paused: boolean) {
  const app = await runtime();
  if (postgresUrl) assert.ok(app.database instanceof PostgresDatabase);
  const left = await actor(app, "alice"), right = await actor(app, "bob");
  const alice = left.token, bob = right.token;
  const first = await create(app, alice, right.id);
  const accepted = await accept(app, bob, String(first.invitation_id), mode);
  const relationshipIds = Object.fromEntries(accepted.map((item: any) => [item.domain, item.relationship_id]));
  const preview = await request(app, bob, "GET", `/buddy/invitations/${first.invitation_id}`);
  assert.equal(preview.body.data.status, "accepted", JSON.stringify(preview.body));
  if (paused) {
    for (const domain of domains) {
      const result = await request(app, alice, "POST", `/buddy/relationships/${relationshipIds[domain]}/pause`,
        { expected_version: 1 });
      assert.equal(result.statusCode, 200, JSON.stringify(result.body));
      assert.equal(result.body.data.status, "paused");
    }
  }
  return { app, alice, bob, aliceId: left.id, bobId: right.id, relationshipIds };
}

async function relationshipAndGrantState(f: Awaited<ReturnType<typeof fixture>>) {
  const { app, aliceId, bobId } = f;
  const relationships = [];
  for (const domain of domains) {
    relationships.push(...await app.database.listCurrentFrogSleepBuddyDomainRelationships("frogsleep", aliceId, domain, true));
    const owned = await app.database.listFrogSleepEntities({ appId: "frogsleep", kind: `${domain}_relationship`, ownerUserId: aliceId });
    const received = await app.database.listFrogSleepEntities({ appId: "frogsleep", kind: `${domain}_relationship`, partnerUserId: aliceId });
    const legacy = [...new Map([...owned, ...received].map(item => [item.id, item])).values()];
    relationships.push(...legacy.filter(item => ["active", "accepted", "paused", "revoked"].includes(item.status ?? "")
      && [item.ownerUserId, item.partnerUserId].includes(aliceId)
      && [item.ownerUserId, item.partnerUserId].includes(bobId)));
  }
  const ids = relationships.map(item => item.id).sort();
  const grants = [];
  for (const id of ids) grants.push(...await app.database.listFrogSleepBuddySharingGrants("frogsleep", id));
  return { ids, grants: grants.sort((left, right) => left.id.localeCompare(right.id)) };
}

function assertReadOnly(payload: any, relationshipIds: Record<string, string>) {
  assert.equal(payload.status, "accepted", JSON.stringify(payload));
  assert.deepEqual(payload.viewer_actions, ["preview"]);
  for (const domain of domains) {
    const result = payload.domain_results.find((item: any) => item.domain === domain);
    assert.equal(result.status, "accepted", JSON.stringify(result));
    assert.equal(result.relationship_id, relationshipIds[domain]);
    assert.deepEqual(result.viewer_actions, []);
    assert.equal(result.error_code, null);
  }
}

for (const mode of ["aggregate", "per-domain"] as const) {
  for (const paused of [false, true]) {
    for (const reverse of [false, true]) {
      test(`${mode} first acceptance: repeat ${paused ? "paused" : "active"} pair invitation is read-only with ${reverse ? "reverse" : "same"} inviter`, async () => {
        const f = await fixture(mode, paused);
        const before = await relationshipAndGrantState(f);
        assert.equal(before.ids.length, 2);
        const inviter = reverse ? f.bob : f.alice, invitee = reverse ? f.alice : f.bob;
        const second = await create(f.app, inviter, reverse ? f.aliceId : f.bobId);
        const path = `/buddy/invitations/${second.invitation_id}`;
        const preview = await request(f.app, invitee, "GET", path);
        assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
        assert.deepEqual(await relationshipAndGrantState(f), before);
        assertReadOnly(second, f.relationshipIds);
        assertReadOnly(preview.body.data, f.relationshipIds);
        assert.equal(preview.body.data.viewer_can_accept, false);

        const retry = await request(f.app, invitee, "POST", `${path}/accept`, {
          expected_version: 1, idempotency_key: `${second.invitation_id}_repeat`,
          sharing_categories: ["presence", "daily_summary", "shared_activity", "weekly_trend"] });
        assert.ok([200, 409].includes(retry.statusCode), JSON.stringify(retry.body));
        const after = await request(f.app, invitee, "GET", path);
        assert.deepEqual(await relationshipAndGrantState(f), before,
          "a repeated invitation must preserve existing relationships and every directional sharing grant");
        assertReadOnly(after.body.data, f.relationshipIds);
        assert.equal(after.body.data.viewer_can_accept, false);
      });
    }
  }
}

test("a revoked canonical relationship shadows a stale active legacy row when determining reinvitation state", async () => {
  const f = await fixture("per-domain", false);
  const revoked = await request(f.app, f.alice, "POST", `/buddy/relationships/${f.relationshipIds.sleep}/revoke`,
    { expected_version: 1 });
  assert.equal(revoked.statusCode, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.data.status, "revoked");
  const now = new Date().toISOString(), legacyId = `reinvite_stale_${randomUUID().replaceAll("-", "")}`;
  await f.app.database.insertFrogSleepEntity({ id: legacyId, appId: "frogsleep", kind: "sleep_relationship",
    ownerUserId: f.aliceId, partnerUserId: f.bobId, status: "active", payload: {}, createdAt: now, updatedAt: now });

  const created = await request(f.app, f.alice, "POST", "/buddy/invitations",
    { target: { user_id: f.bobId }, domains: ["sleep"] });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const preview = await request(f.app, f.bob, "GET", `/buddy/invitations/${created.body.data.invitation_id}`);

  assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.data.status, "pending");
  assert.equal(preview.body.data.viewer_can_accept, true);
  assert.equal(preview.body.data.domain_results[0].relationship_id, null);
  assert.deepEqual(preview.body.data.domain_results[0].viewer_actions, ["accept", "decline"]);
  const stale = await f.app.database.findFrogSleepEntity("sleep_relationship", "frogsleep", legacyId);
  assert.equal(stale?.status, "active", "presentation must not rewrite historical compatibility rows");
});
