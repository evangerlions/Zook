import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../../src/app.module.ts";
import { resolveBodyLogStores } from "../../src/application-bodylog-stores.ts";
import { BodyLogRewardLedger } from "../../src/modules/bodylog/bodylog-reward-ledger.ts";

const url = process.env.BODYLOG_TEST_DATABASE_URL?.trim();
if (!url) throw new Error("BODYLOG_TEST_DATABASE_URL must reference a disposable PostgreSQL database.");

/** Explicit integration gate; never included in the ordinary unit-test glob. */
test("BodyLog live PostgreSQL delivery and retention integrity", async suite => {
  const run = randomUUID().replaceAll("-", "");
  const seed = buildDefaultSeed();
  const alice = `bodylog_pg_alice_${run}`;
  const bob = `bodylog_pg_bob_${run}`;
  for (const userId of [alice, bob]) seed.users!.push({ ...seed.users![0], id: userId, email: `${userId}@example.com` });
  seed.apps!.push({ id: "bodylog", code: "bodylog", name: "BodyLog",
    nameI18n: { "zh-CN": "BodyLog", "en-US": "BodyLog" }, status: "ACTIVE",
    apiDomain: "bodylog.example.com", joinMode: "AUTO", createdAt: new Date().toISOString() });
  for (const userId of [alice, bob]) seed.appUsers!.push({
    id: `bodylog_postgres_${userId}`, appId: "bodylog", userId,
    status: "ACTIVE", joinedAt: new Date().toISOString(), accountRegion: "GLOBAL",
  });
  // Migration startup is intentionally sequential; the test exercises concurrent
  // business transactions, not concurrent schema changes.
  const first = await PostgresDatabase.create(url!, seed);
  const second = await PostgresDatabase.create(url!, {});
  const sql = new Client({ connectionString: url });
  await sql.connect();
  const runtimes = [
    await createApplication({ database: first, queueBackend: "memory" }),
    await createApplication({ database: second, queueBackend: "memory" }),
  ];
  const databases = [first, second];
  const ledgers = databases.map(database => {
    const stores = resolveBodyLogStores(database);
    return new BodyLogRewardLedger(stores.retention, stores.subscription);
  });
  const call = (instance: number, userId: string, method: "GET" | "POST" | "DELETE", path: string, body?: unknown, key?: string) => runtimes[instance].app.handle({
    method, path: `/api/v1/bodylog${path}`, body,
    headers: { authorization: `Bearer ${runtimes[instance].services.tokenService.issueAccessToken(userId, "bodylog")}`,
      "x-app-id": "bodylog", ...(key ? { "idempotency-key": key } : {}) },
  });
  try {
    const stores = resolveBodyLogStores(first);
    for (const feature of ["accountSocial", "friends", "growth"]) await stores.flags.updateBodyLogFeatureFlag(feature, true);
    for (const userId of [alice, bob]) assert.equal((await call(0, userId, "GET", "/profile")).statusCode, 200);
    const created = await call(0, alice, "POST", "/buddies", { partnerUserId: bob, sharedHabitIds: ["water"] });
    assert.equal(created.statusCode, 200);
    const pairId = created.body.data.pair.id as string;
    assert.equal((await call(1, bob, "POST", `/buddies/${pairId}/accept`)).statusCode, 200);
    const operation = `pg-watch-${run}`;
    const payload = { pairId, emoji: "💪", isSameAction: false };
    let receipt: Record<string, unknown>;

    await suite.test("independent application/database instances commit one encouragement for concurrent transport copies", async () => {
      const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => call(i % 2, alice, "POST", "/buddies/encouragements", payload, operation)));
      assert.ok(replies.every(reply => reply.statusCode === 200), JSON.stringify(replies.map(reply => ({ status: reply.statusCode, body: reply.body }))));
      assert.equal(new Set(replies.map(reply => reply.body.data.id)).size, 1);
      receipt = replies[0].body.data;
      const encouragements = await sql.query("SELECT count(*)::int AS count FROM zook_bodylog_buddy_encouragements WHERE pair_id=$1", [pairId]);
      assert.equal(encouragements.rows[0].count, 1);
      const activities = await sql.query("SELECT count(*)::int AS count FROM zook_bodylog_buddy_activities WHERE pair_id=$1 AND type='encouraged'", [pairId]);
      assert.equal(activities.rows[0].count, 1);
      assert.equal((await call(1, alice, "POST", "/buddies/encouragements", { ...payload, emoji: "🔥" }, operation)).statusCode, 409);
    });

    await suite.test("new application and connection recover the persisted confirmation after restart", async () => {
      const restarted = await PostgresDatabase.create(url!, {});
      try {
        const runtime = await createApplication({ database: restarted, queueBackend: "memory" });
        const replay = await runtime.app.handle({ method: "POST", path: "/api/v1/bodylog/buddies/encouragements", body: payload,
          headers: { authorization: `Bearer ${runtime.services.tokenService.issueAccessToken(alice, "bodylog")}`,
            "x-app-id": "bodylog", "idempotency-key": operation } });
        assert.equal(replay.statusCode, 200);
        assert.deepEqual(replay.body.data, receipt!);
      } finally { await restarted.close(); }
    });

    await suite.test("revoked invitation stays revoked across database instances and repeat deletion is confirmed", async () => {
      const invitation = await call(0, alice, "POST", "/invitations", { installId: `pg-alice-${run}` });
      assert.equal(invitation.statusCode, 200);
      const token = invitation.body.data.token;
      assert.equal((await call(0, alice, "DELETE", `/invitations/${token}`)).statusCode, 200);
      assert.equal((await call(1, alice, "DELETE", `/invitations/${token}`)).body.data.revoked, true);
      const result = await call(1, bob, "POST", "/invitations/attribute", { token, installId: `pg-bob-${run}` });
      assert.equal(result.statusCode, 410);
      const row = await sql.query("SELECT revoked_at FROM zook_bodylog_invitations WHERE code=$1", [invitation.body.data.code]);
      assert.ok(row.rows[0].revoked_at instanceof Date);
    });

    await suite.test("concurrent identical reward source grants persist one interval across two transactions", async () => {
      const sourceId = `pg-source-${run}`;
      const grants = await Promise.all(Array.from({ length: 8 }, (_, i) => databases[i % 2].withExclusiveSession(() => ledgers[i % 2].grant(alice, "invitation", sourceId, "premium", "1_day_premium", 1))));
      assert.equal(new Set(grants.map(grant => grant.id)).size, 1);
      assert.equal(new Set(grants.map(grant => grant.startsAt)).size, 1);
      assert.equal(new Set(grants.map(grant => grant.endsAt)).size, 1);
      const persisted = await sql.query("SELECT count(*)::int AS count FROM zook_bodylog_retention_documents WHERE kind='grant' AND user_id=$2 AND data->>'sourceId'=$1", [sourceId, alice]);
      assert.equal(persisted.rows[0].count, 1);
      assert.equal((await ledgers[1].grants(bob)).some(grant => grant.sourceId === sourceId), false);
    });

    await suite.test("source-state and reward-grant writes roll back together on failed transaction", async () => {
      const participationId = `pg-rollback-participation-${run}`;
      const sourceId = `pg-rollback-source-${run}`;
      await assert.rejects(first.withExclusiveSession(async () => {
        await stores.retention.save({ id: participationId, kind: "participation", userId: bob, data: { status: "claimed" } });
        await ledgers[0].grant(bob, "campaign", sourceId, "premium", "1_day_premium", 1);
        throw new Error("injected retention transaction failure");
      }), /injected retention transaction failure/);
      const source = await resolveBodyLogStores(second).retention.list("participation", bob);
      assert.equal(source.some(item => item.id === participationId), false);
      assert.equal((await ledgers[1].grants(bob)).some(grant => grant.sourceId === sourceId), false);
      const replay = await second.withExclusiveSession(() => ledgers[1].grant(bob, "campaign", sourceId, "premium", "1_day_premium", 1));
      assert.equal((await ledgers[0].grants(bob)).filter(grant => grant.id === replay.id).length, 1);
    });
    await suite.test("grant summary is account-free and stable across PostgreSQL instances", async () => {
      const firstSummary = await resolveBodyLogStores(first).retention.grantSummary(new Date().toISOString());
      const secondSummary = await resolveBodyLogStores(second).retention.grantSummary(new Date().toISOString());
      assert.deepEqual(firstSummary, secondSummary);
      assert.ok(firstSummary.some(item => item.source === "invitation" && item.type === "premium" && item.count > 0));
      assert.ok(firstSummary.every(item => Object.keys(item).sort().join() === "count,source,state,type"));
    });

    await suite.test("deleting BodyLog app data removes its grants without deleting another account", async () => {
      assert.ok((await ledgers[0].grants(alice)).length > 0);
      assert.ok((await ledgers[0].grants(bob)).length > 0);
      await first.withExclusiveSession(() => first.deleteAppUserRuntimeData("bodylog", alice));
      assert.deepEqual(await ledgers[1].grants(alice), []);
      assert.ok((await ledgers[1].grants(bob)).length > 0);
      assert.ok(await second.findUserById(alice), "Deleting one app's runtime data does not delete the platform user.");
    });
  } finally {
    await sql.end();
    await Promise.all(databases.map(database => database.close()));
  }
});
