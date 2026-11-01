import assert from "node:assert/strict";
import test from "node:test";
import { estimateAiNovelDisplayMultiplier as estimate } from "../../src/modules/ai-novel/ai-novel-model-display-rate.ts";

test("server estimates base-tier uncached consumption using historical token mix", () => {
  assert.equal(estimate(0.1, 0.2), 0.1);
  assert.equal(estimate(0.7, 1.5), 0.7);
  assert.equal(estimate(1.5, 7.5), 2);
  assert.equal(estimate(3.5, 43.5), 5.5);
});

test("display estimate keeps friendly half steps, minimum and genuine free", () => {
  for (const value of [0.9, 1.1]) assert.equal(estimate(value, value), 1);
  for (const value of [1.4, 1.5, 1.6]) assert.equal(estimate(value, value), 1.5);
  assert.equal(estimate(0.01, 0.01), 0.1);
  assert.equal(estimate(0, 0), 0);
});
