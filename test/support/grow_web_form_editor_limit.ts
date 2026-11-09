/** Seed only the unused synthetic Bob fixture to exercise the last valid PostgreSQL revision. */
import { Pool } from "pg";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { emptyFormRecords } from "../../src/modules/lighttick/form-records/form-records.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  new URL(dsn).port !== "58641" ||
  !/^\/grow_web_u1_f[0-9a-f]+$/.test(new URL(dsn).pathname)
)
  throw Error("Dedicated synthetic form-editor database required");
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool),
  owner = { appId: "lighttick" as const, userId: "user_bob" };
try {
  await repo.transaction(owner, async () => {
    if (await repo.formRecords.get(owner))
      throw Error(
        "Bob fixture is already populated; do not overwrite accepted facts. Use a fresh fixture for a new boundary run.",
      );
    await repo.formRecords.save(
      owner,
      {
        revision: 2147483646,
        data: emptyFormRecords(),
        updated_at: "2026-11-08T00:00:00Z",
      },
      0,
    );
  });
  console.log(
    "Seeded the unused synthetic Bob fixture at the last writable base revision",
  );
} finally {
  await pool.end();
}
