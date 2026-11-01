import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PublicContractValidator } from "../../src/generated/openapi/public-contract-validator.ts";
import { createApplication } from "../support/create-test-application.ts";

test("public config delivers review market switches and validates their types", async () => {
  const seed = buildDefaultSeed();
  const record = seed.appConfigs!.find((entry) => entry.id === "cfg_ai_novel_delivery_config")!;
  const existing = JSON.parse(record.configValue) as Record<string, unknown>;
  const appReview = { enabled: true, markets: {
    app_store: { enabled: true },
    xiaomi: { enabled: true, url: "market://details?id=example" },
  } };
  record.configValue = JSON.stringify({ ...existing, appReview });
  const runtime = await createApplication({ seed });
  try {
    const response = await runtime.app.handle({ method: "GET",
      path: "/api/v1/ai_novel/public/config", headers: { "x-app-id": "ai_novel" } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data.config.appReview, appReview);
    assert.equal(PublicContractValidator.validatePublicConfigData(response.body.data).ok, true);
    assert.equal(PublicContractValidator.validatePublicConfigData({ appId: "ai_novel",
      config: { appReview: { enabled: "true" } } }).ok, false);
  } finally {
    await runtime.close();
  }
});
