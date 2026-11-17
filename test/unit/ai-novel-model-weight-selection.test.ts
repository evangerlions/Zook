import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAiNovelEffectiveModelWeights,
  selectAiNovelChatModelKey,
} from "../../src/modules/ai-novel/ai-novel-model-weight-selection.ts";
import type { AiNovelModelSelectionConfig } from "../../src/shared/types.ts";
import { resolveLlmRoutingUnit, resolveAiNovelModelRoutingUnit } from "../../src/services/llm-routing-affinity.ts";

function config(weights: number[]): AiNovelModelSelectionConfig {
  return {
    schemaVersion: 1,
    chat: {
      default: weights.map((weight, index) => ({
        modelKey: `model-${index + 1}`,
        weight,
      })),
    },
  };
}

test("AINovel weighted model selection follows cumulative array weights", () => {
  const selection = config([50, 30, 20]);
  const identity = { did: "device_abc", uid: "user_xyz" };
  assert.equal(selectAiNovelChatModelKey(selection, identity, () => 0.499), "model-1");
  assert.equal(selectAiNovelChatModelKey(selection, identity, () => 0.5), "model-2");
  assert.equal(selectAiNovelChatModelKey(selection, identity, () => 0.799), "model-2");
  assert.equal(selectAiNovelChatModelKey(selection, identity, () => 0.8), "model-3");
  assert.equal(selectAiNovelChatModelKey(selection, identity, () => 0.999), "model-3");
});

test("AINovel weighted selection passes DID and UID to its affinity resolver", () => {
  let received: [string | undefined, string | undefined] | undefined;
  const selected = selectAiNovelChatModelKey(
    config([50, 50]),
    { did: "device_abc", uid: "user_xyz" },
    (did, uid) => {
      received = [did, uid];
      return 0.75;
    },
  );
  assert.deepEqual(received, ["device_abc", "user_xyz"]);
  assert.equal(selected, "model-2");
});

test("model affinity is stable and independent of provider buckets", () => {
  const selection = config([1, 98, 1]);
  const counts = new Map<string, [number, number]>();
  for (let i = 0; i < 36 ** 3; i += 1) {
    const identity = { did: `device_${i.toString(36).padStart(3, "0")}`, uid: "user_001" };
    const model = selectAiNovelChatModelKey(selection, identity);
    const provider = resolveLlmRoutingUnit(identity.did, identity.uid) < 0.3 ? 0 : 1;
    const pair = counts.get(model) ?? [0, 0];
    pair[provider] += 1;
    counts.set(model, pair);
    assert.equal(selectAiNovelChatModelKey(selection, identity), model);
  }
  for (const model of ["model-1", "model-2", "model-3"]) {
    const [main, backup] = counts.get(model) ?? [0, 0];
    assert.ok(main + backup > 250, `${model} must have enough selections`);
    assert.ok(main / (main + backup) > 0.24 && main / (main + backup) < 0.36, `${model}: ${main}/${main + backup}`);
  }
});

test("model affinity falls back to random parts for invalid identities", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.17;
  try {
    assert.equal(resolveAiNovelModelRoutingUnit(undefined, "user_001"), resolveAiNovelModelRoutingUnit("device_04q", "user_001"));
    const unit = resolveAiNovelModelRoutingUnit(undefined, undefined);
    assert.ok(unit >= 0 && unit < 1);
  } finally {
    Math.random = originalRandom;
  }
});

test("AINovel weighted selection applies model health without changing configured weights", () => {
  const selection = config([50, 30, 20]);
  const health = new Map([
    ["model-1", { available: false, healthScore: 0 }],
    ["model-2", { available: true, healthScore: 50 }],
    ["model-3", { available: true, healthScore: 100 }],
  ]);

  assert.equal(
    selectAiNovelChatModelKey(selection, undefined, () => 0, health),
    "model-2",
  );
  assert.deepEqual(selection.chat.default.map((model) => model.weight), [50, 30, 20]);
});

test("AINovel health selection preserves the base bucket when every model is unavailable", () => {
  const selection = config([50, 30, 20]);
  const health = new Map([
    ["model-1", { available: false, healthScore: 0 }],
    ["model-2", { available: false, healthScore: 0 }],
    ["model-3", { available: false, healthScore: 0 }],
  ]);

  assert.equal(
    selectAiNovelChatModelKey(selection, undefined, () => 0.65, health),
    "model-2",
  );
});

test("AINovel keeps a small probe weight for a reachable model with zero health", () => {
  const weights = buildAiNovelEffectiveModelWeights(
    config([50, 50]),
    new Map([
      ["model-1", { available: true, healthScore: 0 }],
      ["model-2", { available: true, healthScore: 100 }],
    ]),
  );

  assert.equal(weights[0]?.effectiveWeight, 0.005);
  assert.equal(weights[1]?.effectiveWeight, 50);
});

test("AINovel configured zero weight always disables a model", () => {
  const selection = config([0, 100]);
  const health = new Map([
    ["model-1", { available: true, healthScore: 100 }],
    ["model-2", { available: true, healthScore: 100 }],
  ]);

  assert.deepEqual(
    buildAiNovelEffectiveModelWeights(selection, health).map((model) => model.effectiveWeight),
    [0, 100],
  );
  assert.equal(
    selectAiNovelChatModelKey(selection, undefined, () => 0, health),
    "model-2",
  );
});
