import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import {
  exerciseDomainChanges,
  domainChangesOwner as o,
} from "../support/domain-changes-acceptance.ts";
const connectionString = process.env.LIGHTTICK_READING_TEST_DATABASE_URL;
if (
  !connectionString ||
  !["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname) ||
  !/^(?:lighttick_full_migration_[0-9]+|grow_web_u1_content_completion_[0-9]+)$/.test(
    new URL(connectionString).pathname.slice(1),
  )
)
  throw Error("Dedicated localhost synthetic database required");
test("PostgreSQL domain log shares fact/receipt rollback, deduplicates concurrent commits and preserves old sync", async () => {
  await runPostgresMigrations({ connectionString, log: () => {} });
  const pool = new Pool({ connectionString }),
    repo = new PostgresLightTickRepository(pool);
  try {
    await repo.deleteOwnerData(o);
    const { service } = await exerciseDomainChanges(repo);
    const hint = {
      domain: "reading",
      resource: "work",
      id: "readwork-concurrent",
      revision: 1,
      operation: "upsert",
    } as const;
    await Promise.all(
      Array.from({ length: 4 }, () => {
        const peer = new PostgresLightTickRepository(pool);
        return peer.transaction(o, () => peer.domainChanges.append(o, hint));
      }),
    );
    assert.equal(
      (await service.read(o)).items.filter((r) => r.id === hint.id).length,
      1,
    );
    await pool.query(
      "INSERT INTO zook_lighttick_change_log(app_id,user_id,entity_type,entity_id,entity_version,operation,snapshot) VALUES($1,$2,'task','legacy-task',1,'upsert','{}')",
      [o.appId, o.userId],
    );
    const legacy = await repo.pullChanges(o, 0, 100);
    assert.equal(legacy.length, 1);
    assert.equal(legacy[0].entityType, "task");
    const raw = await pool.query(
      "SELECT snapshot FROM zook_lighttick_change_log WHERE app_id=$1 AND user_id=$2 AND entity_type='domain'",
      [o.appId, o.userId],
    );
    assert.ok(raw.rows.length > 0);
    assert.ok(raw.rows.every((r) => Object.keys(r.snapshot).length === 5));
    const beforeHuge = await service.read(o, {
      domain: "reading",
      start: "latest",
    });
    for (const seq of [
      "9223372036854775807",
      "9007199254740994",
      "9007199254740993",
    ]) {
      const big = { ...hint, id: "readwork-big-" + seq };
      await pool.query(
        "INSERT INTO zook_lighttick_change_log(sequence,app_id,user_id,entity_type,entity_id,entity_version,operation,snapshot) VALUES($1::bigint,$2,$3,'domain',$4,1,'upsert',$5::jsonb)",
        [
          seq,
          o.appId,
          o.userId,
          JSON.stringify([big.domain, big.resource, big.id]),
          JSON.stringify(big),
        ],
      );
    }
    const huge = await service.read(o, {
      domain: "reading",
      cursor: beforeHuge.next_cursor,
      limit: "2",
    });
    assert.deepEqual(
      huge.items.map((r) => r.sequence),
      ["9007199254740993", "9007199254740994"],
    );
    assert.equal(huge.has_more, true);
    const last = await service.read(o, {
      domain: "reading",
      cursor: huge.next_cursor,
    });
    assert.deepEqual(
      last.items.map((r) => r.sequence),
      ["9223372036854775807"],
    );
    assert.equal(
      (await service.read(o, { domain: "reading", cursor: last.next_cursor }))
        .items.length,
      0,
    );
  } finally {
    await repo.deleteOwnerData(o);
    assert.equal(
      Number(
        (
          await pool.query(
            "SELECT count(*) AS n FROM zook_lighttick_change_log WHERE app_id=$1 AND user_id=$2",
            [o.appId, o.userId],
          )
        ).rows[0].n,
      ),
      0,
    );
    await pool.end();
  }
});
