import assert from "node:assert/strict";
import test from "node:test";
import { PostgresAppRegistryStore } from "../../src/infrastructure/database/postgres/postgres-app-registry.ts";

test("Postgres app registry keeps lookups parameterized and maps an absent app", async () => {
  const statements: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new PostgresAppRegistryStore(async (sql, values) => {
    statements.push({ sql, values });
    return { rows: [] };
  });
  const value = "unknown' OR 1=1 --";
  assert.equal(await store.findApp(value), undefined);
  assert.equal(await store.findAppByApiDomain(value), undefined);
  assert.equal(await store.findAppConfig(value, "config-test"), undefined);
  assert.ok(statements.every(({ sql }) => !sql.includes(value)));
  assert.deepEqual(statements.map(({ values }) => values), [[value], [value], [value, "config-test"]]);
});

test("Postgres app registry upsert returns the persisted configuration", async () => {
  const config = { id: "config-1", appId: "lighttick", configKey: "feature", configValue: '{"enabled":true}', updatedAt: "2026-11-01T00:00:00.000Z" };
  const store = new PostgresAppRegistryStore(async (sql, values) => {
    assert.match(sql, /ON CONFLICT \(app_id, config_key\)/);
    assert.deepEqual(values, [config.id, config.appId, config.configKey, config.configValue, config.updatedAt]);
    return { rows: [{ id: config.id, app_id: config.appId, config_key: config.configKey, config_value: config.configValue, updated_at: new Date(config.updatedAt) }] };
  });
  assert.deepEqual(await store.upsertAppConfig(config), config);
});
