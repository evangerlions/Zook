import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ExperienceService } from "../../src/modules/lighttick/experience/experience.service.ts";
import {
  experienceOwner as o,
  exerciseExperience,
  exerciseExperiencePages,
} from "../support/experience-acceptance.ts";
const connectionString = process.env.LIGHTTICK_READING_TEST_DATABASE_URL;
if (
  !connectionString ||
  !["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname) ||
  !/^(?:lighttick_full_migration_[0-9]+|grow_web_u1_content_completion_[0-9]+)$/.test(
    new URL(connectionString).pathname.slice(1),
  )
)
  throw Error("Dedicated localhost synthetic database required");
test("real PostgreSQL application/error/type lifecycle, precise aggregate parity, original receipts, tombstones and concurrent names survive reconnect", async () => {
  await runPostgresMigrations({ connectionString, log: () => {} });
  const pool = new Pool({ connectionString }),
    repo = new PostgresLightTickRepository(pool);
  try {
    await repo.deleteOwnerData(o);
    const { b, c } = await exerciseExperience(repo);
    await exerciseExperiencePages(repo);
    const reconnected = new ExperienceService(
      new PostgresLightTickRepository(pool),
    );
    assert.equal(
      (await reconnected.read(o, "error", b.id)).revision,
      b.revision,
    );
    assert.equal((await reconnected.read(o, "error", c.id)).data.date, null);
    await assert.rejects(
      reconnected.read(o, "error_type", "errtype-default-judgment"),
      { statusCode: 410 },
    );
    const outcomes = await Promise.allSettled(
      ["a", "b"].map((suffix) =>
        new ExperienceService(new PostgresLightTickRepository(pool)).write(
          o,
          "error_type",
          "errtype-concurrent-" + suffix,
          "save",
          {
            base_revision: 0,
            data: {
              name: "Concurrent unique name",
              description: "Owner serialized",
            },
          },
          "experience-concurrent-" + suffix,
        ),
      ),
    );
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      outcomes.filter(
        (r) => r.status === "rejected" && r.reason.statusCode === 409,
      ).length,
      1,
    );
    const erased = await pool.query(
      "SELECT request_payload,result_payload FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND operation_id='experience-application-original'",
      [o.appId, o.userId],
    );
    assert.deepEqual(erased.rows[0].request_payload, {});
    assert.equal(erased.rows[0].result_payload.erased, true);
    assert.ok(!JSON.stringify(erased.rows[0]).includes("Exact scenario"));
  } finally {
    await repo.deleteOwnerData(o);
    for (const table of [
      "experience",
      "experience_versions",
      "experience_tombstones",
    ]) {
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) AS n FROM zook_lighttick_" +
                table +
                " WHERE app_id=$1 AND user_id=$2",
              [o.appId, o.userId],
            )
          ).rows[0].n,
        ),
        0,
      );
    }
    await pool.end();
  }
});
