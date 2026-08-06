import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { PostgresBuddyGrowthRepository } from "../../src/infrastructure/database/postgres/postgres-buddy-growth-repository.ts";
import { BuddyGrowthRepository } from "../../src/modules/frogsleep/buddy-growth/buddy-growth-repository.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import type { FrogSleepBuddyDomainSlotRecord } from "../../src/shared/types.ts";

const createdAt = "2026-07-15T00:00:00.000Z";

function ensureInput(domain: "sleep" | "focus") {
  return { appId: "frogsleep", userId: "user_alice", domain, now: createdAt };
}

test("domain slots ensure both domains idempotently and list in stable domain order", async () => {
  const database = new InMemoryDatabase();

  await database.ensureFrogSleepBuddyDomainSlot(ensureInput("sleep"));
  await database.ensureFrogSleepBuddyDomainSlot(ensureInput("focus"));
  const repeated = await database.ensureFrogSleepBuddyDomainSlot({ ...ensureInput("sleep"), now: "2026-07-15T01:00:00.000Z" });

  assert.deepEqual(
    (await database.listFrogSleepBuddyDomainSlots("frogsleep", "user_alice")).map((slot) => slot.domain),
    ["focus", "sleep"],
  );
  assert.equal(repeated.version, 1);
  assert.equal(repeated.createdAt, createdAt);
  assert.equal(repeated.updatedAt, createdAt);
});

test("domain slots isolate exact app user and domain tuples", async () => {
  const database = new InMemoryDatabase();
  await database.ensureFrogSleepBuddyDomainSlot(ensureInput("sleep"));
  await database.ensureFrogSleepBuddyDomainSlot({ ...ensureInput("sleep"), appId: "other_app" });
  await database.ensureFrogSleepBuddyDomainSlot({ ...ensureInput("focus"), userId: "user_bob" });

  assert.equal((await database.findFrogSleepBuddyDomainSlot("frogsleep", "user_alice", "sleep"))?.userId, "user_alice");
  assert.equal(await database.findFrogSleepBuddyDomainSlot("frogsleep", "user_alice", "focus"), undefined);
  assert.equal((await database.listFrogSleepBuddyDomainSlots("other_app", "user_alice")).length, 1);
});

test("domain slots compare and update only the expected version while preserving occupancy invariants", async () => {
  const database = new InMemoryDatabase();
  await database.ensureFrogSleepBuddyDomainSlot(ensureInput("sleep"));

  const occupied = await database.compareAndUpdateFrogSleepBuddyDomainSlot({
    appId: "frogsleep", userId: "user_alice", domain: "sleep", expectedVersion: 1,
    state: "occupied", relationshipId: "relationship_1", updatedAt: "2026-07-15T01:00:00.000Z",
  });
  const stale = await database.compareAndUpdateFrogSleepBuddyDomainSlot({
    appId: "frogsleep", userId: "user_alice", domain: "sleep", expectedVersion: 1,
    state: "available", relationshipId: undefined, updatedAt: "2026-07-15T02:00:00.000Z",
  });
  const missing = await database.compareAndUpdateFrogSleepBuddyDomainSlot({
    appId: "frogsleep", userId: "user_alice", domain: "focus", expectedVersion: 1,
    state: "occupied", relationshipId: "relationship_2", updatedAt: "2026-07-15T02:00:00.000Z",
  });

  assert.deepEqual(occupied, {
    appId: "frogsleep", userId: "user_alice", domain: "sleep", state: "occupied", relationshipId: "relationship_1",
    version: 2, createdAt, updatedAt: "2026-07-15T01:00:00.000Z",
  } satisfies FrogSleepBuddyDomainSlotRecord);
  assert.equal(stale, undefined);
  assert.equal(missing, undefined);
});

test("domain slots reject unavailable relationship identities before writing", async () => {
  const database = new InMemoryDatabase();
  await database.ensureFrogSleepBuddyDomainSlot(ensureInput("sleep"));

  await assert.rejects(
    async () => await database.compareAndUpdateFrogSleepBuddyDomainSlot({
      appId: "frogsleep", userId: "user_alice", domain: "sleep", expectedVersion: 1,
      state: "occupied", relationshipId: "   ", updatedAt: "2026-07-15T01:00:00.000Z",
    }),
    /Invalid FrogSleep buddy domain slot relationship/,
  );
  await assert.rejects(
    async () => await database.compareAndUpdateFrogSleepBuddyDomainSlot({
      appId: "frogsleep", userId: "user_alice", domain: "sleep", expectedVersion: 1,
      state: "available", relationshipId: "relationship_1", updatedAt: "2026-07-15T01:00:00.000Z",
    }),
    /Invalid FrogSleep buddy domain slot relationship/,
  );
  assert.equal((await database.findFrogSleepBuddyDomainSlot("frogsleep", "user_alice", "sleep"))?.state, "available");
});

test("in-memory application slots reject an unknown domain without creating a slot", async () => {
  const database = new InMemoryDatabase();

  await assert.rejects(
    async () => await database.ensureFrogSleepBuddyDomainSlot({ ...ensureInput("sleep"), domain: "bundle" as never }),
    /Invalid FrogSleep buddy domain/,
  );
  assert.deepEqual(await database.listFrogSleepBuddyDomainSlots("frogsleep", "user_alice"), []);
});

test("shared in-memory slots reject unknown state and invalid relationship combinations without mutation", async () => {
  const repository = BuddyGrowthRepository.inMemory();
  await repository.ensureDomainSlot(ensureInput("sleep"));

  await assert.rejects(
    async () => await repository.compareAndUpdateDomainSlot({
      appId: "frogsleep", userId: "user_alice", domain: "sleep", expectedVersion: 1,
      state: "paused" as never, relationshipId: "relationship_1", updatedAt: "2026-07-15T01:00:00.000Z",
    }),
    /Invalid FrogSleep buddy domain slot state/,
  );
  await assert.rejects(
    async () => await repository.compareAndUpdateDomainSlot({
      appId: "frogsleep", userId: "user_alice", domain: "sleep", expectedVersion: 1,
      state: "available", relationshipId: "relationship_1", updatedAt: "2026-07-15T01:00:00.000Z",
    }),
    /Invalid FrogSleep buddy domain slot relationship/,
  );
  assert.deepEqual(await repository.findDomainSlot("frogsleep", "user_alice", "sleep"), {
    appId: "frogsleep", userId: "user_alice", domain: "sleep", state: "available", version: 1,
    createdAt, updatedAt: createdAt,
  });
});

test("domain slot migration enforces tuple, state, version, and relationship invariants", async () => {
  const sql = await readFile(resolve(import.meta.dirname, "../../src/infrastructure/database/postgres/migrations/016_frogsleep_buddy_domain_slots.sql"), "utf8");

  assert.match(sql, /UNIQUE \(app_id, user_id, domain\)/);
  assert.match(sql, /domain IN \('sleep', 'focus'\)/);
  assert.match(sql, /state IN \('available', 'occupied'\)/);
  assert.match(sql, /version >= 1/);
  assert.match(sql, /state = 'available' AND relationship_id IS NULL/);
  assert.match(sql, /state = 'occupied' AND relationship_id IS NOT NULL AND BTRIM\(relationship_id\) <> ''/);
  assert.match(sql, /\(app_id, user_id, domain\)/);
});

test("PostgreSQL domain slots use tuple lookup, stable ordering, and version-guarded updates", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const row = {
    app_id: "frogsleep", user_id: "user_alice", domain: "sleep", state: "available", relationship_id: null,
    version: 1, created_at: createdAt, updated_at: createdAt,
  };
  const repository = new PostgresBuddyGrowthRepository({
    query: async (sql, values) => {
      queries.push({ sql, values });
      return { rows: [row] };
    },
  });

  await repository.ensureDomainSlot(ensureInput("sleep"));
  await repository.findDomainSlot("frogsleep", "user_alice", "sleep");
  await repository.listDomainSlots("frogsleep", "user_alice");
  await repository.compareAndUpdateDomainSlot({
    appId: "frogsleep", userId: "user_alice", domain: "sleep", expectedVersion: 1,
    state: "occupied", relationshipId: "relationship_1", updatedAt: "2026-07-15T01:00:00.000Z",
  });

  assert.match(queries[0]!.sql, /ON CONFLICT \(app_id, user_id, domain\) DO NOTHING/);
  assert.match(queries[1]!.sql, /WHERE app_id=\$1 AND user_id=\$2 AND domain=\$3/);
  assert.match(queries[2]!.sql, /WHERE app_id=\$1 AND user_id=\$2 ORDER BY domain ASC/);
  assert.match(queries[3]!.sql, /WHERE app_id=\$1 AND user_id=\$2 AND domain=\$3 AND version=\$4/);
  assert.match(queries[3]!.sql, /version=version\+1/);
});
