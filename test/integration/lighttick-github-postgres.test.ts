import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { AesGcmPayloadCryptoService } from "../../src/services/aes-gcm-payload-crypto.service.ts";
import { GitHubKeyResolver } from "../../src/modules/lighttick/github/github.crypto.ts";
import { GitHubService } from "../../src/modules/lighttick/github/github.service.ts";
import { GitHubClient } from "../../src/modules/lighttick/github/github.client.ts";
import { GitHubTestRunner } from "../../src/modules/lighttick/github/github-test.runner.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL,
  redis = process.env.GROW_WEB_MODEL_TEST_REDIS_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_") ||
  !redis ||
  new URL(redis).hostname !== "127.0.0.1" ||
  new URL(redis).port !== "58632"
)
  throw Error("Dedicated synthetic PG and Redis required");
test("PG/Redis GitHub encrypted settings survive reconnect, CAS/races roll back, test recovers and owner deletion is complete", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool),
    queue = new InMemoryJobQueue();
  const o = { appId: "lighttick" as const, userId: "github-pg-" + process.pid };
  const first = await KVManager.create({ redisUrl: redis });
  let second: KVManager | undefined;
  const client = new GitHubClient(
    async () =>
      new Response(
        JSON.stringify({
          ref: "refs/heads/main",
          object: { type: "commit", sha: "a".repeat(40) },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  function service(r: PostgresLightTickRepository, kv: KVManager) {
    const keys = new GitHubKeyResolver(kv);
    return new GitHubService(
      r,
      new AesGcmPayloadCryptoService(keys),
      () => keys.ensure(),
      queue,
      client,
    );
  }
  const s = service(repo, first),
    body = {
      base_revision: 0,
      mode: "custom",
      repository: "fixture/content",
      branch: "main",
      token: "SYNTHETIC_GITHUB_TOKEN",
    };
  try {
    const save = repo.saveOperation.bind(repo);
    repo.saveOperation = async () => {
      throw Error("synthetic crash");
    };
    await assert.rejects(s.configure(o, body, "github-crash"));
    assert.equal(await other.github.get(o), undefined);
    repo.saveOperation = save;
    const initial = await s.configure(o, body, "github-crash");
    await first.disconnect();
    second = await KVManager.create({ redisUrl: redis });
    const restarted = service(other, second);
    assert.deepEqual(await restarted.summary(o), initial);
    assert.equal(
      (await restarted.credentials(o, { mode: "custom", revision: 1 })).token,
      body.token,
    );
    const raw = await pool.query(
      "SELECT payload FROM zook_lighttick_github_settings WHERE app_id=$1 AND user_id=$2",
      [o.appId, o.userId],
    );
    assert.ok(!JSON.stringify(raw.rows).includes(body.token));
    const races = await Promise.allSettled([
      restarted.configure(
        o,
        { ...body, base_revision: 1, token: null },
        "github-race-one",
      ),
      restarted.configure(
        o,
        { ...body, base_revision: 1, token: null },
        "github-race-two",
      ),
    ]);
    assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await restarted.summary(o)).revision, 2);
    const work = await restarted.createTest(
      o,
      { settings_revision: 2 },
      "github-test-original",
    );
    const row = (await other.github.test(o, work.id))!;
    await other.transaction(o, () =>
      other.github.saveTest(
        {
          ...row,
          status: "running",
          revision: 2,
          attempt: 1,
          fence: "old",
          lease_until: "2020-01-01T00:00:00Z",
        },
        1,
      ),
    );
    const runner = new GitHubTestRunner(restarted);
    assert.ok((await runner.recover()) >= 1);
    await runner.execute(o, work.id);
    assert.equal(
      (await restarted.testReceipt(o, "github-test-original")).status,
      "succeeded",
    );
    assert.equal(
      (
        await restarted.createTest(
          o,
          { settings_revision: 2 },
          "github-test-original",
        )
      ).id,
      work.id,
    );
    await other.deleteOwnerData(o);
    for (const table of ["github_settings", "github_tests", "operations"])
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM zook_lighttick_" +
              table +
              " WHERE app_id=$1 AND user_id=$2",
            [o.appId, o.userId],
          )
        ).rows[0].n,
        0,
      );
  } finally {
    await other.deleteOwnerData(o);
    await first.disconnect();
    await second?.disconnect();
    await pool.end();
  }
});
