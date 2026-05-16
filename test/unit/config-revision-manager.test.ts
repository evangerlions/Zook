import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { ConfigRevisionManager } from "../../src/infrastructure/kv/config-revision-manager.ts";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";

test("config revision manager stores version metadata, content and restore history", async () => {
  const kvManager = await KVManager.create({
    backend: new InMemoryKVBackend(),
  });
  const manager = new ConfigRevisionManager<string>(kvManager, {
    scope: "test-config-revisions",
  });

  const revision1 = await manager.update('{"theme":"light"}', "initial");
  const revision2 = await manager.update('{"theme":"dark"}', "switch-theme");

  assert.equal(revision1.revision, 1);
  assert.equal(revision2.revision, 2);
  assert.equal(revision2.content, '{"theme":"dark"}');

  const latest = await manager.getLatest();
  assert.equal(latest?.revision, 2);

  const listed = await manager.listVersions();
  assert.deepEqual(
    listed.map((item) => ({ revision: item.revision, desc: item.desc })),
    [
      { revision: 1, desc: "initial" },
      { revision: 2, desc: "switch-theme" },
    ],
  );
  assert.equal(await manager.getVersionCount(), 2);

  const restored = await manager.restore(1, "恢复到版本 R1");
  assert.equal(restored.revision, 3);
  assert.equal(restored.content, '{"theme":"light"}');
  assert.equal(restored.desc, "恢复到版本 R1");

  const revision1Content = await manager.getVersion(1);
  assert.equal(revision1Content?.content, '{"theme":"light"}');
  assert.equal(await manager.getVersionCount(), 3);
});

test("app config service keeps config history and can restore old revisions", async () => {
  const kvBackend = new InMemoryKVBackend();
  const runtime = await createApplication({
    kvBackend,
  });

  const configKey = "admin.delivery_config";
  const initialCount = await runtime.services.appConfigService.getRevisionCount("app_a", configKey);
  const initialRevision = await runtime.services.appConfigService.getLatestRevision("app_a", configKey);

  assert.equal(initialCount, 1);
  assert.match(initialRevision?.content ?? "", /featureFlags/);

  const updatedRevision = await runtime.services.appConfigService.setValue(
    "app_a",
    configKey,
    '{"featureFlags":{"enableVipBanner":false}}',
    "disable-banner",
  );

  assert.equal(updatedRevision.revision, 2);
  assert.equal(await runtime.services.appConfigService.getRevisionCount("app_a", configKey), 2);
  assert.equal(
    await runtime.services.appConfigService.getValue("app_a", configKey),
    '{"featureFlags":{"enableVipBanner":false}}',
  );

  const restoredRevision = await runtime.services.appConfigService.restoreValue(
    "app_a",
    configKey,
    1,
    "恢复到版本 R1",
  );
  assert.equal(restoredRevision.revision, 3);
  assert.equal(restoredRevision.desc, "恢复到版本 R1");
  assert.match((await runtime.services.appConfigService.getValue("app_a", configKey)) ?? "", /featureFlags/);

  const revisions = await runtime.services.appConfigService.listRevisions("app_a", configKey);
  assert.deepEqual(
    revisions.map((item) => item.revision),
    [1, 2, 3],
  );
});

test("app config service treats latest revision as canonical and self-heals stale direct records", async () => {
  const kvBackend = new InMemoryKVBackend();
  const runtime = await createApplication({
    kvBackend,
  });

  const configKey = "admin.delivery_config";
  await runtime.services.appConfigService.setValue(
    "app_a",
    configKey,
    '{"release":{"version":"2026.04.03"}}',
    "publish",
  );

  const staleRecord = runtime.database.appConfigs.find(
    (item) => item.appId === "app_a" && item.configKey === configKey,
  );
  assert.ok(staleRecord);
  staleRecord.configValue = '{"stale":true}';
  staleRecord.updatedAt = "2026-04-03T10:00:00.000Z";

  assert.equal(
    await runtime.services.appConfigService.getValue("app_a", configKey),
    '{"release":{"version":"2026.04.03"}}',
  );
  const currentCachedRecord = runtime.database.appConfigs.find(
    (item) => item.appId === "app_a" && item.configKey === configKey,
  );
  assert.equal(currentCachedRecord?.configValue, '{"release":{"version":"2026.04.03"}}');

  const latestRevision = await runtime.services.appConfigService.getLatestRevision("app_a", configKey);
  const currentRecord = await runtime.services.appConfigService.getRecord("app_a", configKey);
  assert.equal(currentRecord?.updatedAt, latestRevision?.createdAt);
});
