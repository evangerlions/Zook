import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PublicContractValidator } from "../../src/generated/openapi/public-contract-validator.ts";
import { createApplication } from "../support/create-test-application.ts";

test("AINovel config exposes only the RevenueCat proxy and preserves other settings", async () => {
  const seed = buildDefaultSeed();
  const record = seed.appConfigs!.find((entry) => entry.id === "cfg_ai_novel_delivery_config")!;
  const existing = JSON.parse(record.configValue);
  record.configValue = JSON.stringify({ ...existing, customFlag: true, billing: { revenueCat: {
    enabled: false, configVersion: "old", publicSdkKeys: { ios: "old" }, proxyUrl: "https://proxy.example/",
  } } });
  const runtime = await createApplication({ seed });
  try {
    const config = await runtime.services.adminConsoleService.getConfig("ai_novel");
    assert.deepEqual(JSON.parse(config.rawJson).billing, { revenueCat: { proxyUrl: "https://proxy.example/" } });
    assert.equal(JSON.parse(config.rawJson).customFlag, true);
    const response = await runtime.app.handle({ method: "GET", path: "/api/v1/ai_novel/public/config", headers: { "x-app-id": "ai_novel" } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data.config.billing, { revenueCat: { proxyUrl: "https://proxy.example/" } });
    assert.equal(response.body.data.config.customFlag, true);
    assert.equal(PublicContractValidator.validatePublicConfigData(response.body.data).ok, true);
    await runtime.services.adminConsoleService.updateConfig("ai_novel", record.configValue);
    const saved = await runtime.services.adminConsoleService.getConfig("ai_novel");
    assert.deepEqual(JSON.parse(saved.rawJson).billing, { revenueCat: { proxyUrl: "https://proxy.example/" } });
    assert.equal(PublicContractValidator.validatePublicConfigData({ appId: "ai_novel", config: { billing: { revenueCat: { enabled: true } } } }).ok, false);
  } finally {
    await runtime.close();
  }
});
