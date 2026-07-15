import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { PostgresBuddyGrowthRepository } from "../../src/infrastructure/database/postgres/postgres-buddy-growth-repository.ts";
import { BuddyGrowthRepository } from "../../src/modules/frogsleep/buddy-growth/buddy-growth-repository.ts";
import {
  canonicalFrogSleepBuddyParticipants,
  normalizeFrogSleepBuddyDomainRelationship,
} from "../../src/modules/frogsleep/buddy-growth/buddy-domain-relationship-validation.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import type { FrogSleepBuddyDomainRelationshipRecord } from "../../src/shared/types.ts";

const createdAt = "2026-07-15T00:00:00.000Z";

function relationship(
  overrides: Partial<FrogSleepBuddyDomainRelationshipRecord> = {},
): FrogSleepBuddyDomainRelationshipRecord {
  return {
    id: "relationship_opaque_1",
    appId: "frogsleep",
    domain: "sleep",
    userIdLow: "user_alice",
    userIdHigh: "user_bob",
    status: "active",
    pausedByUserIds: [],
    version: 1,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

test("participant helper canonicalizes distinct nonblank user identities", () => {
  assert.deepEqual(canonicalFrogSleepBuddyParticipants("user_bob", "user_alice"), {
    userIdLow: "user_alice", userIdHigh: "user_bob",
  });
  assert.throws(() => canonicalFrogSleepBuddyParticipants(" ", "user_bob"), /participant/);
  assert.throws(() => canonicalFrogSleepBuddyParticipants("user_alice", "user_alice"), /distinct/);
});

test("relationship normalization enforces canonical participants and state facts", () => {
  assert.deepEqual(normalizeFrogSleepBuddyDomainRelationship(relationship({
    status: "paused", pausedByUserIds: ["user_bob", "user_alice", "user_bob"],
  })).pausedByUserIds, ["user_alice", "user_bob"]);
  assert.throws(() => normalizeFrogSleepBuddyDomainRelationship(relationship({
    userIdLow: "user_bob", userIdHigh: "user_alice",
  })), /canonical/);
  assert.throws(() => normalizeFrogSleepBuddyDomainRelationship(relationship({
    status: "active", pausedByUserIds: ["user_alice"],
  })), /active/);
  assert.throws(() => normalizeFrogSleepBuddyDomainRelationship(relationship({
    status: "paused", pausedByUserIds: ["user_mallory"],
  })), /paused participant/);
  assert.throws(() => normalizeFrogSleepBuddyDomainRelationship(relationship({
    status: "revoked", revokedAt: undefined,
  })), /revoked/);
  assert.throws(() => normalizeFrogSleepBuddyDomainRelationship(relationship({ version: 0 })), /version/);
  assert.throws(() => normalizeFrogSleepBuddyDomainRelationship(relationship({ domain: "bundle" as never })), /domain/);
});

for (const [name, create] of [
  ["application database", () => new InMemoryDatabase()],
  ["shared repository", () => BuddyGrowthRepository.inMemory()],
] as const) {
  test(`${name} inserts relationship facts once and scopes lookup by app`, async () => {
    const repository = create();
    const inserted = await repository.insertFrogSleepBuddyDomainRelationship?.(relationship())
      ?? await repository.insertDomainRelationship?.(relationship());
    const duplicate = relationship({ status: "paused", pausedByUserIds: ["user_alice"], version: 2 });
    const replayed = await repository.insertFrogSleepBuddyDomainRelationship?.(duplicate)
      ?? await repository.insertDomainRelationship?.(duplicate);

    assert.equal(inserted.status, "active");
    assert.equal(replayed.status, "active");
    const found = await repository.findFrogSleepBuddyDomainRelationship?.("frogsleep", inserted.id)
      ?? await repository.findDomainRelationship?.("frogsleep", inserted.id);
    const otherApp = await repository.findFrogSleepBuddyDomainRelationship?.("other_app", inserted.id)
      ?? await repository.findDomainRelationship?.("other_app", inserted.id);
    assert.equal(found?.id, inserted.id);
    assert.equal(otherApp, undefined);
  });

  test(`${name} validates relationship facts before inserting`, async () => {
    const repository = create();
    const invalid = relationship({ userIdLow: "user_alice", userIdHigh: "user_alice" });
    await assert.rejects(
      async () => await repository.insertFrogSleepBuddyDomainRelationship?.(invalid)
        ?? await repository.insertDomainRelationship?.(invalid),
      /distinct/,
    );
    const list = await repository.listCurrentFrogSleepBuddyDomainRelationships?.("frogsleep", "user_alice", "sleep")
      ?? await repository.listCurrentDomainRelationships?.("frogsleep", "user_alice", "sleep");
    assert.deepEqual(list, []);
  });

  test(`${name} rejects a second current relationship for the same pair and domain`, async () => {
    const repository = create();
    const insert = async (record: FrogSleepBuddyDomainRelationshipRecord) =>
      await repository.insertFrogSleepBuddyDomainRelationship?.(record)
      ?? await repository.insertDomainRelationship?.(record);
    await insert(relationship());
    await assert.rejects(async () => await insert(relationship({ id: "relationship_opaque_2" })), /current pair/);
    await insert(relationship({ id: "relationship_revoked", status: "revoked", revokedAt: createdAt }));
  });

  test(`${name} lists only current relationships for the exact user and domain`, async () => {
    const repository = create();
    const insert = async (record: FrogSleepBuddyDomainRelationshipRecord) =>
      await repository.insertFrogSleepBuddyDomainRelationship?.(record)
      ?? await repository.insertDomainRelationship?.(record);
    await insert(relationship({ id: "rel_active_late", updatedAt: "2026-07-15T03:00:00.000Z" }));
    await insert(relationship({ id: "rel_paused", domain: "focus", status: "paused", pausedByUserIds: ["user_bob"], updatedAt: "2026-07-15T02:00:00.000Z" }));
    await insert(relationship({ id: "rel_active_early", userIdLow: "user_aaron", userIdHigh: "user_alice", updatedAt: "2026-07-15T01:00:00.000Z" }));
    await insert(relationship({ id: "rel_revoked", status: "revoked", revokedAt: "2026-07-15T04:00:00.000Z" }));
    await insert(relationship({ id: "rel_other_app", appId: "other_app" }));

    const list = await repository.listCurrentFrogSleepBuddyDomainRelationships?.("frogsleep", "user_alice", "sleep")
      ?? await repository.listCurrentDomainRelationships?.("frogsleep", "user_alice", "sleep");
    assert.deepEqual(list.map((item: FrogSleepBuddyDomainRelationshipRecord) => item.id), ["rel_active_late", "rel_active_early"]);
  });

  test(`${name} compare-and-update is version guarded and leaves stale writes unchanged`, async () => {
    const repository = create();
    const inserted = await repository.insertFrogSleepBuddyDomainRelationship?.(relationship())
      ?? await repository.insertDomainRelationship?.(relationship());
    const update = {
      appId: "frogsleep", id: inserted.id, expectedVersion: 1, status: "paused" as const,
      pausedByUserIds: ["user_alice", "user_alice"], revokedAt: undefined,
      updatedAt: "2026-07-15T01:00:00.000Z",
    };
    const updated = await repository.compareAndUpdateFrogSleepBuddyDomainRelationship?.(update)
      ?? await repository.compareAndUpdateDomainRelationship?.(update);
    const stale = await repository.compareAndUpdateFrogSleepBuddyDomainRelationship?.({
      ...update, status: "revoked", pausedByUserIds: [], revokedAt: "2026-07-15T02:00:00.000Z",
    }) ?? await repository.compareAndUpdateDomainRelationship?.({
      ...update, status: "revoked", pausedByUserIds: [], revokedAt: "2026-07-15T02:00:00.000Z",
    });
    const missing = await repository.compareAndUpdateFrogSleepBuddyDomainRelationship?.({ ...update, id: "missing" })
      ?? await repository.compareAndUpdateDomainRelationship?.({ ...update, id: "missing" });

    assert.deepEqual(updated?.pausedByUserIds, ["user_alice"]);
    assert.equal(updated?.version, 2);
    assert.equal(stale, undefined);
    assert.equal(missing, undefined);
    const stored = await repository.findFrogSleepBuddyDomainRelationship?.("frogsleep", inserted.id)
      ?? await repository.findDomainRelationship?.("frogsleep", inserted.id);
    assert.equal(stored?.status, "paused");
  });
}

test("domain relationship migration enforces facts and current-pair uniqueness", async () => {
  const sql = await readFile(resolve(import.meta.dirname, "../../src/infrastructure/database/postgres/migrations/016_frogsleep_buddy_domain_relationships.sql"), "utf8");
  assert.match(sql, /CHECK \(domain IN \('sleep', 'focus'\)\)/);
  assert.match(sql, /CHECK \(status IN \('active', 'paused', 'revoked'\)\)/);
  assert.match(sql, /CHECK \(version >= 1\)/);
  assert.match(sql, /CHECK \(BTRIM\(user_id_low\) <> '' AND BTRIM\(user_id_high\) <> '' AND user_id_low < user_id_high\)/);
  assert.match(sql, /paused_by_user_ids <@ ARRAY\[user_id_low, user_id_high\]/);
  assert.match(sql, /array_position\(paused_by_user_ids, NULL\) IS NULL/);
  assert.match(sql, /WHERE status IN \('active', 'paused'\)/);
  assert.match(sql, /UNIQUE INDEX[\s\S]*app_id, domain, user_id_low, user_id_high/);
  assert.match(sql, /app_id, user_id_low, domain, status/);
  assert.match(sql, /app_id, user_id_high, domain, status/);
  assert.doesNotMatch(sql, /\bemail\b|invite|health|content/i);
});

test("PostgreSQL relationship persistence uses scoped IDs, current filters, stable ordering, and CAS", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const row = {
    id: "relationship_opaque_1", app_id: "frogsleep", domain: "sleep",
    user_id_low: "user_alice", user_id_high: "user_bob", status: "active",
    paused_by_user_ids: [], version: 1, revoked_at: null, created_at: createdAt, updated_at: createdAt,
  };
  const repository = new PostgresBuddyGrowthRepository({
    query: async (sql, values) => { queries.push({ sql, values }); return { rows: [row] }; },
  });

  await repository.insertDomainRelationship(relationship());
  await repository.findDomainRelationship("frogsleep", "relationship_opaque_1");
  await repository.listCurrentDomainRelationships("frogsleep", "user_alice", "sleep");
  await repository.compareAndUpdateDomainRelationship({
    appId: "frogsleep", id: "relationship_opaque_1", expectedVersion: 1,
    status: "paused", pausedByUserIds: ["user_alice"], updatedAt: "2026-07-15T01:00:00.000Z",
  });

  assert.match(queries[0]!.sql, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(queries[1]!.sql, /WHERE app_id=\$1 AND id=\$2/);
  assert.match(queries[2]!.sql, /status IN \('active','paused'\)/);
  assert.match(queries[2]!.sql, /user_id_low=\$2 OR user_id_high=\$2/);
  assert.match(queries[2]!.sql, /ORDER BY updated_at DESC, id DESC/);
  assert.match(queries[3]!.sql, /WHERE app_id=\$1 AND id=\$2 AND version=\$3/);
  assert.match(queries[3]!.sql, /version=version\+1/);
});
