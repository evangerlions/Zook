import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import {
  FormRecordsService,
  emptyFormRecords,
} from "../../src/modules/lighttick/form-records/form-records.service.ts";
import { exportReview } from "../../src/modules/lighttick/knowledge/review.export.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !/^\/grow_web_u1_[a-zA-Z0-9_]+$/.test(new URL(dsn).pathname)
)
  throw Error("Dedicated synthetic form-editor PG database required");
test("PG section CAS preserves unrelated columns, original receipts survive reconnect and all fields roll back on receipt failure", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool),
    s = new FormRecordsService(repo),
    second = new FormRecordsService(other),
    o = { appId: "lighttick" as const, userId: "sections-pg-" + process.pid };
  try {
    const data = {
      ...emptyFormRecords(),
      modules: [
        {
          id: "m-preserved",
          name: "Keep category",
          color: "#123456",
          order: 1,
        },
      ],
      todos: [
        {
          date: "2026-11-08",
          title: "Legacy todo",
          done: false,
          old_id: "keep-original-id",
        },
      ],
    };
    await s.save(o, { base_revision: 0, data }, "sections-pg-seed");
    const first = await s.patch(
      o,
      "habits",
      {
        base_revision: 1,
        value: { "2026-11-08": { minutes: 30, note: "Manual only" } },
      },
      "sections-pg-habit",
    );
    assert.deepEqual(first.data.modules, data.modules);
    const racing = await Promise.allSettled([
      s.patch(
        o,
        "decisions",
        {
          base_revision: 2,
          value: [
            {
              date: "2026-11-08",
              title: "Decision",
              probability: 0,
              legacy_source: "Preserved",
            },
          ],
        },
        "sections-pg-decision",
      ),
      second.patch(
        o,
        "predictions",
        {
          base_revision: 2,
          value: [
            { date: "2026-11-08", statement: "Prediction", probability: "" },
          ],
        },
        "sections-pg-prediction",
      ),
    ]);
    assert.equal(racing.filter((x) => x.status === "fulfilled").length, 1);
    const current = await second.read(o),
      original = repo.saveOperation.bind(repo);
    repo.saveOperation = async () => {
      throw Error("PG receipt failure");
    };
    await assert.rejects(
      s.patch(
        o,
        "custom",
        {
          base_revision: current.revision,
          value: {
            customFields: [{ key: "f-number", label: "Count", type: "number" }],
            customRecords: [{ "f-number": 0 }],
          },
        },
        "sections-pg-crash",
      ),
    );
    repo.saveOperation = original;
    assert.deepEqual(await second.read(o), current);
    assert.equal(await other.getOperation(o, "sections-pg-crash"), undefined);
    const body = {
      base_revision: current.revision,
      value: [
        {
          date: "2026-11-08",
          title: "Legacy todo",
          done: true,
          old_id: "keep-original-id",
        },
      ],
    };
    const accepted = await s.patch(o, "todos", body, "sections-pg-todo");
    assert.equal(accepted.data.todos[0].old_id, "keep-original-id");
    assert.deepEqual(
      await second.patch(o, "todos", body, "sections-pg-todo"),
      accepted,
    );
    assert.equal((await repo.listTasks(o)).length, 0);
    assert.equal((await repo.listReflections(o)).length, 0);
    const full = JSON.parse(
      (await exportReview(other, o, async () => {})).content,
    );
    assert.deepEqual(full.form_records, accepted);
    assert.equal(
      (await second.read({ ...o, userId: "other-owner" })).revision,
      0,
    );
    await repo.deleteOwnerData(o);
    assert.equal((await second.read(o)).revision, 0);
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});
test("PG owner-lock wait freezes original section body and stale late writes cannot revive a cleared form", async () => {
  const pool = new Pool({ connectionString: dsn }),
    r = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool),
    s = new FormRecordsService(other),
    o = { appId: "lighttick" as const, userId: "sections-late-" + process.pid };
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((yes) => (entered = yes)),
    gate = new Promise<void>((yes) => (release = yes));
  try {
    const held = r.transaction(o, async () => {
      entered();
      await gate;
    });
    await started;
    const body = {
        base_revision: 0,
        value: [
          {
            date: "2026-11-08",
            thought: "Original frozen",
            action: "No automatic task",
          },
        ],
      },
      saving = s.patch(o, "reviews", body, "sections-pg-frozen");
    body.value[0].thought = "Changed outside request";
    release();
    await held;
    const saved = await saving;
    assert.equal(saved.data.reviews[0].thought, "Original frozen");
    assert.equal(
      (await other.getOperation(o, "sections-pg-frozen"))!.requestPayload!
        .value[0].thought,
      "Original frozen",
    );
    await s.clear(o, { base_revision: saved.revision }, "sections-pg-clear");
    await assert.rejects(
      s.patch(
        o,
        "reviews",
        {
          base_revision: saved.revision,
          value: [{ thought: "Late old draft" }],
        },
        "sections-pg-late",
      ),
      { statusCode: 409 },
    );
    assert.deepEqual((await s.read(o)).data, emptyFormRecords());
  } finally {
    release?.();
    await r.deleteOwnerData(o);
    await pool.end();
  }
});
