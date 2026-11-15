import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import {
  FormRecordsService,
  emptyFormRecords,
} from "../../src/modules/lighttick/form-records/form-records.service.ts";
import {
  predictionCalibration,
  predictionSource,
} from "../../src/modules/lighttick/form-records/prediction-calibration.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_calibration_")
)
  throw Error("Dedicated calibration DB required");
test("PostgreSQL calibration reads canonical form snapshot, survives reconnect, detects changed indexes and has no write effects", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    reconnectPool = new Pool({ connectionString: dsn }),
    o = { appId: "lighttick" as const, userId: "calibration-" + randomUUID() },
    repo = new PostgresLightTickRepository(pool),
    forms = new FormRecordsService(repo);
  try {
    await forms.save(
      o,
      {
        base_revision: 0,
        data: {
          ...emptyFormRecords(),
          predictions: Array.from({ length: 60 }, (_, i) => ({
            date: "2026-11-15",
            statement: "PG " + i,
            probability: 100,
            result: i % 2 ? "correct" : "incorrect",
          })),
        },
      },
      "pg-calibration-save",
    );
    const current = await forms.read(o),
      r = predictionCalibration(current.data.predictions, current.revision, {
        window: "3",
        page: "2",
        trend_page: "2",
      });
    assert.equal(r.resolved, 60);
    assert.equal(r.high_confidence.items.length, 10);
    assert.equal(r.trend.items.length, 8);
    assert.equal(r.accuracy, 0.5);
    assert.equal(r.brier_score, 0.5);
    assert.equal(r.buckets[9].count, 60);
    assert.equal((await forms.read(o)).revision, 1);
    assert.deepEqual((await forms.read(o)).data, current.data);
    const reconnect = new FormRecordsService(
      new PostgresLightTickRepository(reconnectPool),
    );
    assert.deepEqual(await reconnect.read(o), current);
    const changed = structuredClone(current.data);
    changed.predictions.reverse();
    await forms.save(
      o,
      { base_revision: 1, data: changed },
      "pg-calibration-change",
    );
    const next = await reconnect.read(o);
    assert.throws(
      () =>
        predictionSource(next.data.predictions, next.revision, {
          index: "0",
          revision: "1",
        }),
      { statusCode: 409 },
    );
    assert.equal((await forms.read({ ...o, userId: "not-owner" })).revision, 0);
    await repo.deleteOwnerData(o);
    assert.equal((await forms.read(o)).revision, 0);
  } finally {
    await repo.deleteOwnerData(o);
    await reconnectPool.end();
    await pool.end();
  }
});
