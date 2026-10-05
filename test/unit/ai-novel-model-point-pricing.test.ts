import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryCache } from "../../src/infrastructure/cache/redis/in-memory-cache.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { normalizeAiNovelModelPointPricingAdminInput } from "../../src/modules/ai-novel/ai-novel-model-point-pricing-config.ts";
import { AiNovelModelPointPricingConfigService } from "../../src/modules/ai-novel/ai-novel-model-point-pricing-config.service.ts";
import { CommonLlmConfigService } from "../../src/services/common-llm-config.service.ts";
import { CommonPasswordConfigService } from "../../src/services/common-password-config.service.ts";
import { PasswordManager } from "../../src/services/password-manager.ts";
import { SecretReferenceResolver } from "../../src/services/secret-reference-resolver.ts";
import { VersionedAppConfigService } from "../../src/services/versioned-app-config.service.ts";

async function createService() {
  const kvManager = await KVManager.create({ backend: new InMemoryKVBackend() });
  const database = new InMemoryDatabase();
  const configService = new VersionedAppConfigService(
    database,
    new InMemoryCache(),
    kvManager,
  );
  const passwordConfigService = new CommonPasswordConfigService(new PasswordManager(kvManager));
  const commonLlmConfigService = new CommonLlmConfigService(
    configService,
    new SecretReferenceResolver(passwordConfigService),
  );
  return new AiNovelModelPointPricingConfigService(configService, commonLlmConfigService);
}

test("AINovel model point defaults cover the app model catalog with OpenRouter-based point conversion", async () => {
  const service = await createService();
  const config = await service.getCurrentConfig();
  const keys = config.models.map((model) => model.modelKey);

  assert.equal(keys.length, 18);
  assert.ok(keys.includes("doubao-seed-2.0-pro"));
  assert.ok(keys.includes("qwen3.8-max"));
  assert.ok(keys.every((key) => !key.startsWith("tokenplan-") && !key.startsWith("openrouter-")));
  assert.ok(keys.includes("text-embedding-v4"));
  assert.deepEqual(
    config.models.find((model) => model.modelKey === "qwen3.8-flash"),
    {
      modelKey: "qwen3.8-flash",
      cachedInputPointsPerMillionTokens: 10,
      inputPointsPerMillionTokens: 50,
      outputPointsPerMillionTokens: 150,
    },
  );
  assert.deepEqual(
    config.models.find((model) => model.modelKey === "deepseek-v4-flash"),
    {
      modelKey: "deepseek-v4-flash",
      cachedInputPointsPerMillionTokens: 10,
      inputPointsPerMillionTokens: 10,
      outputPointsPerMillionTokens: 20,
    },
  );
  assert.deepEqual(
    await service.resolveModelPointPricing("ai_novel", "qwen3.8-flash"),
    { cachedInputPointsPerMillionTokens: 10, inputPointsPerMillionTokens: 50, outputPointsPerMillionTokens: 150 },
  );
  assert.equal(await service.resolveModelPointPricing("other_app", "qwen3.8-flash"), undefined);
});

test("AINovel model point config accepts explicit zero and rejects partial, duplicate, and negative rates", () => {
  assert.deepEqual(
    normalizeAiNovelModelPointPricingAdminInput({
      schemaVersion: 1,
      models: [{
        modelKey: "free-model",
        inputPointsPerMillionTokens: 0,
        outputPointsPerMillionTokens: 0,
      }],
    }),
    {
      schemaVersion: 1,
      models: [{ modelKey: "free-model", inputPointsPerMillionTokens: 0, outputPointsPerMillionTokens: 0 }],
    },
  );

  const invalidConfigs = [
    { schemaVersion: 1, models: [{ modelKey: "m", inputPointsPerMillionTokens: 1 }] },
    { schemaVersion: 1, models: [
      { modelKey: "m", inputPointsPerMillionTokens: 1, outputPointsPerMillionTokens: 2 },
      { modelKey: "m", inputPointsPerMillionTokens: 1, outputPointsPerMillionTokens: 2 },
    ] },
    { schemaVersion: 1, models: [{ modelKey: "m", inputPointsPerMillionTokens: -1, outputPointsPerMillionTokens: 2 }] },
  ];
  for (const config of invalidConfigs) {
    assert.throws(() => normalizeAiNovelModelPointPricingAdminInput(config));
  }
});

test("AINovel pricing is versioned and runtime reads the latest app-scoped model rate", async () => {
  const service = await createService();
  await service.updateConfig({
    schemaVersion: 1,
    models: [{ modelKey: "qwen3.8-flash", inputPointsPerMillionTokens: 1500, outputPointsPerMillionTokens: 4700 }],
  });
  await service.updateConfig({
    schemaVersion: 1,
    models: [{ modelKey: "qwen3.8-flash", inputPointsPerMillionTokens: 2000, outputPointsPerMillionTokens: 6000 }],
  });

  assert.deepEqual(
    await service.resolveModelPointPricing("ai_novel", "qwen3.8-flash"),
    { inputPointsPerMillionTokens: 2000, outputPointsPerMillionTokens: 6000 },
  );
  const previous = await service.getDocument(1);
  assert.deepEqual(previous.config.models, [{
    modelKey: "qwen3.8-flash",
    inputPointsPerMillionTokens: 1500,
    outputPointsPerMillionTokens: 4700,
  }]);
});
