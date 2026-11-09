import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  readFileSync(
    resolve(root, "test/fixtures/lighttick/risk-baseline.json"),
    "utf8",
  ),
);
const mode = process.argv[2] ?? "--check";
if (
  !["--check", "--unit", "--postgres"].includes(mode) ||
  process.argv.length > 3
)
  throw Error("Use --check (read-only default), --unit or --postgres");
for (const fixture of catalog.fixtures) {
  const actual = createHash("sha256")
    .update(readFileSync(resolve(root, fixture.path)))
    .digest("hex");
  if (actual !== fixture.sha256)
    throw Error("Reviewed golden fixture changed: " + fixture.path);
}
const ledger = JSON.parse(
  readFileSync(
    resolve(root, "docs/plans/grow-zook-native-web/migration-ledger.json"),
    "utf8",
  ),
);
const identities = new Set<string>();
for (const e of ledger.entries) {
  const id = e.method + " " + e.legacy_path;
  if (
    identities.has(id) ||
    !e.source_locations?.length ||
    !e.migration_disposition ||
    !e.required_verification?.length
  )
    throw Error("Legacy tracing is incomplete: " + id);
  identities.add(id);
}
if (identities.size !== 516)
  throw Error(
    "Legacy scope changed; review the complete inventory before updating this baseline",
  );
const unitTests = [
  ...new Set<string>(
    catalog.unit_groups.flatMap((g: { tests: string[] }) => g.tests),
  ),
];
for (const p of [...unitTests, ...catalog.postgres_tests])
  readFileSync(resolve(root, p));
console.log(
  JSON.stringify(
    {
      scope: catalog.scope,
      fixture_digests_verified: catalog.fixtures.length,
      legacy_operations_traced: identities.size,
      legacy_operations_still_unreviewed: ledger.entries.filter(
        (e: { disposition: string }) => e.disposition === "unreviewed",
      ).length,
      unclosed_gates: catalog.unclosed_gates,
      mode,
    },
    null,
    2,
  ),
);
if (mode !== "--check") {
  const env = { ...process.env };
  if (mode === "--postgres") {
    const dsn = env.LIGHTTICK_TEST_DATABASE_URL,
      redis = env.GROW_WEB_MODEL_TEST_REDIS_URL;
    if (
      !dsn ||
      new URL(dsn).hostname !== "127.0.0.1" ||
      !/^\/grow_web_u1_[a-zA-Z0-9_]+$/.test(new URL(dsn).pathname)
    )
      throw Error("Dedicated synthetic localhost PG database required");
    if (
      !redis ||
      new URL(redis).hostname !== "127.0.0.1" ||
      new URL(redis).port !== "58632"
    )
      throw Error("Dedicated synthetic localhost Redis required");
    if (
      env.LIGHTTICK_MODEL_TEST_REDIS_URL &&
      env.LIGHTTICK_MODEL_TEST_REDIS_URL !== redis
    )
      throw Error("Redis test identities disagree");
    env.LIGHTTICK_MODEL_TEST_REDIS_URL = redis;
    const { Pool } = await import("pg"),
      pool = new Pool({
        connectionString: dsn,
        application_name: "grow-risk-preflight",
      });
    try {
      const active = await pool.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='grow-web-fixture'",
      );
      if (active.rows[0].n)
        throw Error(
          "Stop the synthetic HTTP fixture or select a separate PG database before replaying migration tests",
        );
    } finally {
      await pool.end();
    }
  }
  const files = mode === "--postgres" ? catalog.postgres_tests : unitTests;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-transform-types",
      "--test",
      "--test-concurrency=1",
      ...files,
    ],
    { cwd: root, env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
