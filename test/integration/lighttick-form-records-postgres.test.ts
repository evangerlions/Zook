import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import {
  FormRecordsService,
  emptyFormRecords,
} from "../../src/modules/lighttick/form-records/form-records.service.ts";
import { LightTickRecordService } from "../../src/modules/lighttick/lighttick-record.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  new URL(dsn).port !== "58639" ||
  new URL(dsn).pathname !== "/grow_web_u1_f08"
)
  throw Error("Dedicated disposable form-records database required");
test("real PG form save/receipt CAS and rollback, export/reconnect, scoped clear and owner deletion", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    r = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool);
  const o = { appId: "lighttick" as const, userId: "forms-pg-" + process.pid },
    b = {
      base_revision: 0,
      data: {
        ...emptyFormRecords(),
        modules: [
          { id: "m-synthetic", name: "Learning", color: "#123456", order: 1 },
        ],
        checkins: { "2026-11-08": { "m-synthetic": 3 } },
        habits: { "2026-11-08": { minutes: 25, note: "Synthetic" } },
        customRecords: [{ text: "Preserved" }],
      },
    };
  const s = new FormRecordsService(r),
    second = new FormRecordsService(other);
  try {
    const saved = await s.save(o, b, "forms-original");
    assert.deepEqual(await second.save(o, b, "forms-original"), saved);
    const original = r.saveOperation.bind(r);
    r.saveOperation = async () => {
      throw Error("PG crash before receipt");
    };
    await assert.rejects(s.clear(o, { base_revision: 1 }, "forms-clear"));
    r.saveOperation = original;
    assert.deepEqual(await second.read(o), saved);
    assert.equal(await other.getOperation(o, "forms-clear"), undefined);
    const results = await Promise.allSettled([
      s.save(o, { ...b, base_revision: 1 }, "forms-concurrent-one"),
      second.save(o, { ...b, base_revision: 1 }, "forms-concurrent-two"),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    const records = new LightTickRecordService(r);
    await records.mutate(
      o,
      "record-forms-synthetic",
      "save",
      {
        base_version: 0,
        raw_text: "Keep independent fact",
        record_date: "2026-11-08",
        prompt_kind: "free",
        guided_answers: {},
        tags: [],
      },
      "forms-record-original",
    );
    const cleared = await s.clear(o, { base_revision: 2 }, "forms-clear");
    assert.deepEqual(cleared.data, emptyFormRecords());
    assert.deepEqual(
      await second.clear(o, { base_revision: 2 }, "forms-clear"),
      cleared,
    );
    assert.equal(
      (await other.getRecord(o, "record-forms-synthetic"))?.payload.raw_text,
      "Keep independent fact",
    );
    assert.equal(
      (await second.read({ ...o, userId: "other-synthetic" })).revision,
      0,
    );
    await r.deleteOwnerData(o);
    assert.equal((await second.read(o)).revision, 0);
    assert.equal(await other.getOperation(o, "forms-original"), undefined);
  } finally {
    await r.deleteOwnerData(o);
    await pool.end();
  }
});
