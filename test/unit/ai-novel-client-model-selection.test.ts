import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../../src/shared/errors.ts";
import { buildAiNovelPublicModels, parseAiNovelClientModelSelection } from "../../src/modules/ai-novel/ai-novel-client-model-selection.ts";
import { AiNovelModelSelectionConfigService } from "../../src/modules/ai-novel/ai-novel-model-selection-config.service.ts";
import { assertNoClientModelSelection } from "../../src/modules/ai-novel/ai-novel-llm-request-validation.ts";
import type { LlmServiceConfig, AiNovelModelPointPricingConfig } from "../../src/shared/types.ts";
import type { CommonLlmConfigService } from "../../src/services/common-llm-config.service.ts";
import type { VersionedAppConfigService } from "../../src/services/versioned-app-config.service.ts";
import type { AiNovelModelPointPricingConfigService } from "../../src/modules/ai-novel/ai-novel-model-point-pricing-config.service.ts";
import type { LlmModelHealthReader } from "../../src/services/llm-model-health.service.ts";

function fixture() {
  const model = (key: string, enabled = true) => ({ key, label: key, kind: "chat", strategy: "weighted", routes: [{ provider: "p", providerModel: `secret-${key}`, enabled, weight: 100 }] });
  const common = { enabled: true, providers: [{ key: "p", enabled: true, apiKey: "secret" }], models: [model("qwen3.6-plus"), model("manual"), model("disabled", false), model("unpriced")] } as unknown as LlmServiceConfig;
  const pricing: AiNovelModelPointPricingConfig = { schemaVersion: 1, models: [
    { modelKey: "qwen3.6-plus", inputPointsPerMillionTokens: 100, outputPointsPerMillionTokens: 650 },
    { modelKey: "manual", inputPointsPerMillionTokens: 200, cachedInputPointsPerMillionTokens: 20, outputPointsPerMillionTokens: 400 },
    { modelKey: "disabled", inputPointsPerMillionTokens: 100, outputPointsPerMillionTokens: 100 },
  ] };
  const service = new AiNovelModelSelectionConfigService(
    { getValue: async () => undefined } as unknown as VersionedAppConfigService,
    { getCurrentConfig: async () => common } as CommonLlmConfigService,
    { getModelHealth: async (modelKey: string) => ({ modelKey, sampleSize: 0, available: true, healthScore: 100 }) } as LlmModelHealthReader,
    undefined,
    { getCurrentConfig: async () => pricing } as AiNovelModelPointPricingConfigService,
  );
  return { common, pricing, service };
}

test("model preference is strict and absence remains Auto", () => {
  assert.deepEqual(parseAiNovelClientModelSelection(undefined), { mode: "auto" });
  assert.deepEqual(parseAiNovelClientModelSelection({ mode: "manual", modelKey: " manual " }), { mode: "manual", modelKey: "manual" });
  for (const value of [null, [], {}, { mode: "R2" }, { mode: "auto", modelKey: "x" }, { mode: "manual" }, { mode: "manual", modelKey: "x", provider: "p" }]) {
    assert.throws(() => parseAiNovelClientModelSelection(value), ApplicationError);
  }
  for (const field of ["model", "modelKey", "providerModel", "tier", "routingTier", "modelTier"]) {
    assert.throws(() => assertNoClientModelSelection({ [field]: "x" }), ApplicationError);
  }
});

test("catalog derives rates and eligibility from server configuration without provider data", () => {
  const { common, pricing } = fixture();
  const models = buildAiNovelPublicModels(common, pricing);
  assert.deepEqual(models.map((item) => item.key), ["manual", "qwen3.6-plus"]);
  assert.deepEqual(models[0], { key: "manual", label: "manual", localIcon: "generic", onlineIcon: "", inputMultiplier: 2, cachedInputMultiplier: 0.2, outputMultiplier: 4, contextWindowTokens: 256000 });
  assert.equal(models[1]?.cachedInputMultiplier, 1); // No cache discount when unset.
  assert.ok(!JSON.stringify(models).includes("secret"));
  assert.deepEqual(buildAiNovelPublicModels({ ...common, enabled: false }, pricing), []);
});

test("catalog display overrides sort and hide without inventing eligibility or pricing", () => {
  const { common, pricing } = fixture();
  const catalog = [
    { modelKey: "manual", label: "Display M", description: "Intro", badge: "Preview", localIcon: "kimi", onlineIcon: "https://cdn.example.com/m.png", sortOrder: -1 },
    { modelKey: "qwen3.6-plus", enabled: false },
    { modelKey: "unpriced", enabled: true },
  ];
  const rows = buildAiNovelPublicModels(common, pricing, catalog);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.key, "manual");
  assert.equal(rows[0]?.label, "Display M");
  assert.equal(rows[0]?.description, "Intro");
  assert.equal(rows[0]?.localIcon, "kimi");
  assert.equal(rows[0]?.onlineIcon, "https://cdn.example.com/m.png");
  assert.equal(rows[0]?.inputMultiplier, 2);
});

test("manual stays on selected logical model even if automatic retry excludes it; Auto retains pool", async () => {
  const { service } = fixture();
  assert.equal(await service.resolveChatModelKey(undefined, { selection: { mode: "manual", modelKey: "manual" }, excludedModelKeys: new Set(["manual"]) }), "manual");
  assert.equal(await service.resolveChatModelKey(undefined, { selection: { mode: "auto" } }), "qwen3.6-plus");
  for (const modelKey of ["disabled", "unpriced", "provider-prefixed-unknown"]) {
    await assert.rejects(service.resolveChatModelKey(undefined, { selection: { mode: "manual", modelKey } }), (error: unknown) => error instanceof ApplicationError && error.code === "AI_MODEL_NOT_AVAILABLE");
  }
});

test("catalog exposes configured context tiers with the same cache semantics as settlement", () => {
  const { common, pricing } = fixture();
  pricing.models[1]!.contextTiers = [{ abovePromptTokens: 32000, inputPointsPerMillionTokens: 300, outputPointsPerMillionTokens: 600 }];
  assert.deepEqual(buildAiNovelPublicModels(common, pricing)[0]?.contextTiers, [{
    abovePromptTokens: 32000, inputMultiplier: 3, cachedInputMultiplier: 0.2, outputMultiplier: 6,
  }]);
  delete pricing.models[1]!.cachedInputPointsPerMillionTokens;
  assert.equal(buildAiNovelPublicModels(common, pricing)[0]?.contextTiers?.[0]?.cachedInputMultiplier, 3);
});
