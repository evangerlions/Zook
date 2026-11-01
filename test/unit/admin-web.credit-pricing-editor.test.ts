import assert from "node:assert/strict";
import test from "node:test";
import { createRows, hasInvalidRates, toConfig } from "../../apps/admin-web/app/lib/credit-pricing-editor.ts";
import type { AdminAiNovelModelPointPricingDocument } from "../../apps/admin-web/app/lib/types/config.ts";

function document(): AdminAiNovelModelPointPricingDocument {
  return {
    app: { appId: "ai_novel" } as AdminAiNovelModelPointPricingDocument["app"],
    configKey: "ai_novel.model_point_pricing", isLatest: true, revisions: [],
    availableModels: [{ key: "model-a", label: "A", kind: "chat", configuredAvailable: true,
      reference: { source: "product", match: "exact" } }],
    config: { schemaVersion: 1, models: [{ modelKey: "model-a", inputPointsPerMillionTokens: 100,
      outputPointsPerMillionTokens: 400, cachedInputPointsPerMillionTokens: 20,
      contextTiers: [{ abovePromptTokens: 32000, inputPointsPerMillionTokens: 200, outputPointsPerMillionTokens: 800 }] }] },
  };
}

test("credit pricing editor round-trips cache and context tiers without dropping fields", () => {
  const payload = document();
  assert.deepEqual(toConfig(createRows(payload)), payload.config);
});

test("editing a base multiplier retains tiers and cache without mutating loaded document", () => {
  const payload = document();
  const rows = createRows(payload);
  rows[0].inputPointsPerMillionTokens = 150;
  rows[0].contextTiers![0].outputPointsPerMillionTokens = 900;
  const config = toConfig(rows);
  assert.equal(config.models[0].cachedInputPointsPerMillionTokens, 20);
  assert.equal(config.models[0].contextTiers![0].outputPointsPerMillionTokens, 900);
  assert.equal(payload.config.models[0].contextTiers![0].outputPointsPerMillionTokens, 800);
  config.models[0].contextTiers![0].outputPointsPerMillionTokens = 1000;
  assert.equal(rows[0].contextTiers![0].outputPointsPerMillionTokens, 900);
});

test("blank cache is omitted for input fallback while explicit zero stays free", () => {
  const rows = createRows(document());
  rows[0].cachedInputPointsPerMillionTokens = undefined;
  assert.equal(Object.hasOwn(toConfig(rows).models[0], "cachedInputPointsPerMillionTokens"), false);
  rows[0].cachedInputPointsPerMillionTokens = 0;
  assert.equal(toConfig(rows).models[0].cachedInputPointsPerMillionTokens, 0);
});

test("unpriced models remain blank, rather than receiving a free zero default", () => {
  const payload = document();
  payload.config.models = [];
  const rows = createRows(payload);
  assert.equal(rows[0].inputPointsPerMillionTokens, undefined);
  assert.deepEqual(toConfig(rows).models, []);
  assert.equal(hasInvalidRates(rows), false);
  rows[0].contextTiers = [{ abovePromptTokens: 0, inputPointsPerMillionTokens: 0, outputPointsPerMillionTokens: 0 }];
  assert.equal(hasInvalidRates(rows), true);
});

test("validation catches incomplete bases, over-priced cache, and nonascending tiers", () => {
  const rows = createRows(document());
  assert.equal(hasInvalidRates(rows), false);
  rows[0].cachedInputPointsPerMillionTokens = 101;
  assert.equal(hasInvalidRates(rows), true);
  rows[0].cachedInputPointsPerMillionTokens = 20;
  rows[0].contextTiers!.push({ ...rows[0].contextTiers![0] });
  assert.equal(hasInvalidRates(rows), true);
  rows[0].contextTiers = [];
  rows[0].outputPointsPerMillionTokens = undefined;
  assert.equal(hasInvalidRates(rows), true);
});
