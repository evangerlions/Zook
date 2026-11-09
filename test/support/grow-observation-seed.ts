/** Explicit localhost synthetic fixture only; production domain/CSV worker with a controlled past clock. */
import { Pool } from "pg";
import { writeFileSync } from "node:fs";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { observationFixture } from "./lighttick-observation-fixture.ts";
import { MaterialService } from "../../src/modules/lighttick/investments/materials/material.service.ts";
const dsn = process.env.GROW_WEB_TEST_DSN;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !/^\/grow_web_u1_[a-f0-9]+$/.test(new URL(dsn).pathname)
)
  throw Error("Dedicated synthetic local DB required");
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool);
try {
  const f = await observationFixture(repo, "user_course_9"),
    mid = "inv-historical-daily-monitor";
  await f.s.write(
    f.o,
    "monitors",
    mid,
    {
      base_revision: 0,
      fields: {
        ...f.monitorFields,
        name: "Synthetic historical daily monitor",
      },
      consent: true,
    },
    "seed-monitor-original",
  );
  const w = await f.s.createWork(
    f.o,
    "check",
    mid,
    { base_revision: 1, consent: true },
    "seed-check-original",
  );
  await f.runner.execute(f.o, w.id);
  const done = await f.s.readWork(f.o, w.id);
  if (done.event_disposition !== "created")
    throw Error("Synthetic event seed did not trigger");
  const monitor = (await f.s.store.get(f.o, "monitors", mid))!;
  await repo.transaction(f.o, () =>
    f.s.store.updateRuntime(f.o, mid, {
      ...monitor.runtime!,
      next_at: "2026-11-20T08:00:00Z",
    }),
  );
  const material = await new MaterialService(
    repo,
    async () => {},
    f.s.clock,
  ).write(
    f.o,
    "inv-observation-source-material",
    {
      base_revision: 0,
      title: "Synthetic prediction evidence",
      content: "Synthetic original evidence\nKnown limitations",
      locator: "p1",
      source_url: null,
      available_at: "2026-11-01T08:00:00Z",
      contrary_evidence: "Synthetic contrary evidence",
      instrument_id: f.instrument.id,
      account_id: null,
    },
    "seed-material-original",
  );
  const result = {
    synthetic: true,
    controlled_registration_clock: "2026-11-02T08:00:00Z",
    controlled_check_clock: "2026-11-06T08:00:00Z",
    owner: "user_course_9",
    prediction_id: f.pid,
    monitor_id: mid,
    event_id: done.event_id,
    instrument: f.instrument,
    baseline_id: f.baseline.id,
    daily_id: f.daily.id,
    material_id: material.id,
    material_digest: material.content_digest,
  };
  writeFileSync(
    ".artifacts/predictions-20261107/fixture.json",
    JSON.stringify(result, null, 2),
  );
  console.log("Synthetic observation fixture seeded");
} finally {
  await pool.end();
}
