import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";

test("kv manager supports JSON read and write", async () => {
  const kvManager = await KVManager.create({
    backend: new InMemoryKVBackend(),
  });

  await kvManager.setJson("common", "email-service", {
    provider: "tencent_ses",
    enabled: true,
  });

  const value = await kvManager.getJson<{ provider: string; enabled: boolean }>(
    "common",
    "email-service",
  );

  assert.deepEqual(value, {
    provider: "tencent_ses",
    enabled: true,
  });
});

test("kv manager isolates values by scope and key", async () => {
  const kvManager = await KVManager.create({
    backend: new InMemoryKVBackend(),
  });

  await kvManager.setJson("app_a", "config", { feature: "alpha" });
  await kvManager.setJson("app_b", "config", { feature: "beta" });

  const appA = await kvManager.getJson<{ feature: string }>("app_a", "config");
  const appB = await kvManager.getJson<{ feature: string }>("app_b", "config");

  assert.equal(appA?.feature, "alpha");
  assert.equal(appB?.feature, "beta");
});
