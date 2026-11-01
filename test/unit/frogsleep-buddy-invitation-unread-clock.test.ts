import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { ApplicationDatabase } from "../../src/infrastructure/database/application-database.ts";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { invitationUnread } from "../../src/modules/frogsleep/buddy-growth/buddy-invitation-presentation.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import type { FrogSleepBuddyInvitationBundleRecord } from "../../src/shared/types.ts";

const frozenNow = new Date("2026-10-24T01:02:03.456Z");
const appId = "frogsleep";
const invitationId = "same-ms-invitation";
const creator = "user_alice";
const recipient = "user_bob";

test("invitation unread ordering remains durable within one wall-clock millisecond", { concurrency: false }, async (suite) => {
  await suite.test("creator sees an accepted decision as new until previewed", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: frozenNow });
    const database = fixture();
    const before = await creatorUnread(database);
    accept(database, "sleep");
    const afterDecision = await creatorUnread(database);
    database.markFrogSleepBuddyInvitationRead(appId, invitationId, creator);
    const afterPreview = await creatorUnread(database);
    assert.equal(Date.now(), frozenNow.getTime(), "the wall clock must never advance to make this test pass");
    assert.deepEqual({ before, afterDecision, afterPreview },
      { before: false, afterDecision: true, afterPreview: false });
  });

  await suite.test("preview then a different domain decision in the same millisecond becomes unread again", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: frozenNow });
    const database = fixture();
    accept(database, "sleep");
    database.markFrogSleepBuddyInvitationRead(appId, invitationId, creator);
    const afterFirstPreview = await creatorUnread(database);
    accept(database, "focus");
    const afterNewDecision = await creatorUnread(database);
    database.markFrogSleepBuddyInvitationRead(appId, invitationId, creator);
    const afterSecondPreview = await creatorUnread(database);
    assert.equal(Date.now(), frozenNow.getTime());
    assert.deepEqual({ afterFirstPreview, afterNewDecision, afterSecondPreview },
      { afterFirstPreview: false, afterNewDecision: true, afterSecondPreview: false });
  });

  await suite.test("upserted changes become unread but an identical accepted decision does not", async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: frozenNow });
    const database = fixture();
    database.markFrogSleepBuddyInvitationRead(appId, invitationId, creator);
    const pending = database.findFrogSleepBuddyInvitationDomainDecision(appId, invitationId, "sleep")!;
    const changed = database.upsertFrogSleepBuddyInvitationDomainDecision({ ...pending, status: "accepted", version: 2 });
    const afterDecision = await creatorUnread(database);
    database.markFrogSleepBuddyInvitationRead(appId, invitationId, creator);
    const afterPreview = await creatorUnread(database);
    database.upsertFrogSleepBuddyInvitationDomainDecision({ ...changed, updatedAt: "2100-01-01T00:00:00.000Z" });
    const afterRepeatedUpsert = await creatorUnread(database);
    assert.deepEqual({ afterDecision, afterPreview, afterRepeatedUpsert },
      { afterDecision: true, afterPreview: false, afterRepeatedUpsert: false });
  });

});

function fixture() {
  const database = new InMemoryDatabase(buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const now = new Date().toISOString();
  const bundle: FrogSleepBuddyInvitationBundleRecord = {
    id: invitationId, appId, inviterUserId: creator, inviteeUserId: recipient,
    shareCode: "CLOCK1", handoffToken: "clock-token", shareLink: "frogsleep://invite/clock-token",
    locale: "en", status: "pending", domains: ["sleep", "focus"], version: 1,
    domainInvitationIds: {}, domainErrorCodes: {},
    createdAt: now, updatedAt: now, expiresAt: "2026-11-01T00:00:00.000Z",
  };
  database.upsertFrogSleepBuddyInvitationBundle(bundle);
  for (const domain of bundle.domains) {
    database.upsertFrogSleepBuddyInvitationDomainDecision({ appId, invitationId, domain,
      status: "pending", version: 1, createdAt: now, updatedAt: now });
  }
  return database;
}

function accept(database: InMemoryDatabase, domain: "sleep" | "focus") {
  const now = new Date().toISOString();
  const result = database.compareAndUpdateFrogSleepBuddyInvitationDomainDecision({
    appId, invitationId, domain, expectedVersion: 1, status: "accepted", decidedByUserId: recipient,
    decidedAt: now, updatedAt: now, idempotencyKeyHash: `clock-${domain}`, relationshipId: `${domain}-relationship`,
  });
  assert.ok(result, "exercise the real successful persistence mutation");
  assert.equal(result.status, "accepted");
  assert.equal(result.version, 2);
}

async function creatorUnread(database: InMemoryDatabase) {
  const bundle = database.findFrogSleepBuddyInvitationBundle(appId, invitationId);
  assert.ok(bundle);
  return await invitationUnread(database, bundle, creator);
}


const postgresUrl = process.env.FROGSLEEP_REINVITE_TEST_DATABASE_URL?.trim();

test("PostgreSQL invitation ordering respects durable future read timestamps", {
  concurrency: false, skip: !postgresUrl,
}, async (suite) => {
  const url = disposableLocalPostgresUrl(postgresUrl!);
  const sql = new Client({ connectionString: url });
  const database = await PostgresDatabase.create(url,
    buildDefaultSeed(new DevelopmentPasswordHasher(), { includeFrogSleep: true }));
  await sql.connect();
  try {
    for (const mode of ["compare-and-update", "upsert"] as const) {
      await suite.test(`${mode} advances past a future read and repeated upsert stays read`, async () => {
        const id = `unread_clock_${randomUUID()}`;
        try { await postgresScenario(database, sql, id, mode); }
        finally {
          await sql.query("DELETE FROM zook_frogsleep_buddy_invitation_domain_decisions WHERE app_id=$1 AND invitation_id=$2", [appId, id]);
          await sql.query("DELETE FROM zook_frogsleep_buddy_invitation_bundles WHERE app_id=$1 AND id=$2", [appId, id]);
        }
      });
    }
  } finally {
    await sql.end();
    await database.close();
  }
});

function disposableLocalPostgresUrl(value: string) {
  const parsed = new URL(value);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname), "use a dedicated localhost test database");
  assert.ok(!["", "/", "/postgres", "/template0", "/template1"].includes(parsed.pathname), "do not use a default database");
  return value;
}

async function seedPostgresInvitation(database: ApplicationDatabase, id: string) {
  const now = frozenNow.toISOString();
  await database.upsertFrogSleepBuddyInvitationBundle({ id, appId, inviterUserId: creator,
    inviteeUserId: recipient, shareCode: id, handoffToken: `${id}-token`, shareLink: "frogsleep://invite/clock",
    locale: "en", status: "pending", domains: ["sleep"], version: 1, domainInvitationIds: {}, domainErrorCodes: {},
    createdAt: now, updatedAt: now, expiresAt: "2100-01-01T00:00:00.000Z" });
  await database.upsertFrogSleepBuddyInvitationDomainDecision({ appId, invitationId: id, domain: "sleep",
    status: "pending", version: 1, createdAt: now, updatedAt: now });
}

async function postgresScenario(database: ApplicationDatabase, sql: Client, id: string,
  mode: "compare-and-update" | "upsert") {
  await seedPostgresInvitation(database, id);
  await sql.query(`UPDATE zook_frogsleep_buddy_invitation_bundles
    SET inviter_read_at=$3, invitee_read_at=$3 WHERE app_id=$1 AND id=$2`, [appId, id, "2099-01-01T00:00:00.000Z"]);
  assert.equal(await persistenceUnread(database, id), false);
  const changed = await changePostgresDecision(database, id, mode);
  const afterDecision = await persistenceUnread(database, id);
  assert.ok(Date.parse(changed.updatedAt) > Date.parse("2099-01-01T00:00:00.000Z"), "persist changes after both durable read marks");
  await database.markFrogSleepBuddyInvitationRead(appId, id, creator);
  const afterPreview = await persistenceUnread(database, id);
  await database.upsertFrogSleepBuddyInvitationDomainDecision({ ...changed, updatedAt: "2100-01-01T00:00:00.000Z" });
  const afterRepeatedUpsert = await persistenceUnread(database, id);
  assert.deepEqual({ afterDecision, afterPreview, afterRepeatedUpsert },
    { afterDecision: true, afterPreview: false, afterRepeatedUpsert: false });
}

async function changePostgresDecision(database: ApplicationDatabase, id: string, mode: "compare-and-update" | "upsert") {
  const pending = await database.findFrogSleepBuddyInvitationDomainDecision(appId, id, "sleep");
  assert.ok(pending);
  const result = mode === "upsert"
    ? await database.upsertFrogSleepBuddyInvitationDomainDecision({ ...pending, status: "accepted", version: 2 })
    : await database.compareAndUpdateFrogSleepBuddyInvitationDomainDecision({ appId, invitationId: id,
      domain: "sleep", expectedVersion: 1, status: "accepted", decidedByUserId: recipient,
      decidedAt: frozenNow.toISOString(), updatedAt: frozenNow.toISOString(), idempotencyKeyHash: `${id}-accept` });
  assert.ok(result);
  assert.equal(result.status, "accepted");
  assert.equal(result.version, 2);
  return result;
}

async function persistenceUnread(database: ApplicationDatabase, id: string) {
  const bundle = await database.findFrogSleepBuddyInvitationBundle(appId, id);
  assert.ok(bundle);
  return await invitationUnread(database, bundle, creator);
}
