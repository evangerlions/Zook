import assert from "node:assert/strict";
import test from "node:test";
import { PostgresBuddyGrowthRepository } from "../../src/infrastructure/database/postgres/postgres-buddy-growth-repository.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import type { FrogSleepBuddyInvitationDomainDecisionRecord } from "../../src/shared/types.ts";

function decision(domain: "sleep" | "focus"): FrogSleepBuddyInvitationDomainDecisionRecord {
  return {
    appId: "frogsleep",
    invitationId: "invitation_1",
    domain,
    status: "pending",
    version: 1,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

test("domain decisions upsert by invitation and domain without changing the original creation time", async () => {
  const database = new InMemoryDatabase();
  await database.upsertFrogSleepBuddyInvitationDomainDecision(decision("sleep"));
  await database.upsertFrogSleepBuddyInvitationDomainDecision({
    ...decision("sleep"),
    status: "accepted",
    version: 2,
    decidedByUserId: "user_bob",
    decidedAt: "2026-07-14T01:00:00.000Z",
    idempotencyKeyHash: "hash_only",
    updatedAt: "2026-07-14T01:00:00.000Z",
  });

  const stored = await database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "invitation_1", "sleep");
  assert.deepEqual(stored, {
    ...decision("sleep"),
    status: "accepted",
    version: 2,
    decidedByUserId: "user_bob",
    decidedAt: "2026-07-14T01:00:00.000Z",
    idempotencyKeyHash: "hash_only",
    updatedAt: "2026-07-14T01:00:00.000Z",
  });
  assert.equal((await database.listFrogSleepBuddyInvitationDomainDecisions("frogsleep", "invitation_1")).length, 1);
});

test("domain decisions use an exact app invitation domain lookup and stable domain ordering", async () => {
  const database = new InMemoryDatabase();
  await database.upsertFrogSleepBuddyInvitationDomainDecision(decision("sleep"));
  await database.upsertFrogSleepBuddyInvitationDomainDecision(decision("focus"));
  await database.upsertFrogSleepBuddyInvitationDomainDecision({ ...decision("sleep"), appId: "other_app" });

  assert.equal(await database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "invitation_1", "focus")?.domain, "focus");
  assert.equal(await database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "invitation_1", "bundle" as never), undefined);
  assert.deepEqual(
    (await database.listFrogSleepBuddyInvitationDomainDecisions("frogsleep", "invitation_1")).map((item) => item.domain),
    ["focus", "sleep"],
  );
});

test("PostgreSQL domain decisions keep creation time on upsert and list by stable domain order", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const row = {
    app_id: "frogsleep", invitation_id: "invitation_1", domain: "sleep", status: "pending", version: 1,
    created_at: "2026-07-14T00:00:00.000Z", updated_at: "2026-07-14T00:00:00.000Z",
  };
  const repository = new PostgresBuddyGrowthRepository({
    query: async (sql, values) => {
      queries.push({ sql, values });
      return { rows: [row] };
    },
  });

  await repository.upsertInvitationDomainDecision(decision("sleep"));
  await repository.findInvitationDomainDecision("frogsleep", "invitation_1", "sleep");
  await repository.listInvitationDomainDecisions("frogsleep", "invitation_1");

  assert.match(queries[0]!.sql, /ON CONFLICT \(app_id, invitation_id, domain\) DO UPDATE SET/);
  assert.doesNotMatch(queries[0]!.sql, /created_at=EXCLUDED\.created_at/);
  assert.match(queries[1]!.sql, /WHERE app_id=\$1 AND invitation_id=\$2 AND domain=\$3/);
  assert.match(queries[2]!.sql, /WHERE app_id=\$1 AND invitation_id=\$2 ORDER BY domain ASC/);
});
