import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateLlmPointMicros,
  pointMicrosToPoints,
  sumPointMicros,
} from "../../src/services/llm-point-pricing.ts";

const rates = {
  inputPointsPerMillionTokens: 100,
  outputPointsPerMillionTokens: 400,
};

test("three-rate pricing implements 1 point per 10,000 weighted tokens exactly", () => {
  const usage = { promptTokens: 30_000, cachedInputTokens: 24_000, completionTokens: 2_000, totalTokens: 32_000 };
  assert.equal(pointMicrosToPoints(calculateLlmPointMicros(usage, { ...rates, cachedInputPointsPerMillionTokens: 20 })), 1.88);
  assert.equal(pointMicrosToPoints(calculateLlmPointMicros(usage, { inputPointsPerMillionTokens: 650, cachedInputPointsPerMillionTokens: 80, outputPointsPerMillionTokens: 2000 })), 9.82);
  assert.equal(calculateLlmPointMicros({ ...usage, cachedInputTokens: 30_001 }, rates), undefined);
  assert.equal(calculateLlmPointMicros(usage, { ...rates, cachedInputPointsPerMillionTokens: -1 }), undefined);
  assert.equal(pointMicrosToPoints(calculateLlmPointMicros(usage, rates)), 3.8);
});

test("point pricing calculates input and output independently without rounding", () => {
  assert.equal(calculateLlmPointMicros({
    promptTokens: 1_000_001,
    completionTokens: 500_000,
    totalTokens: 1_500_001,
  }, rates), "300000100");
  assert.equal(pointMicrosToPoints("300000100"), 300.0001);
});

test("point pricing preserves a real zero and rejects unavailable or invalid usage", () => {
  assert.equal(calculateLlmPointMicros({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }, rates), "0");
  assert.equal(pointMicrosToPoints("0"), 0);
  assert.equal(calculateLlmPointMicros(undefined, rates), undefined);
  assert.equal(calculateLlmPointMicros({ promptTokens: -1, completionTokens: 1, totalTokens: 0 }, rates), undefined);
  assert.equal(calculateLlmPointMicros({ promptTokens: 1, completionTokens: 1, totalTokens: 2 }, undefined), undefined);
  assert.equal(pointMicrosToPoints("not-a-number"), undefined);
});

test("point aggregation sums exact micro-points and leaves empty totals unavailable", () => {
  assert.equal(sumPointMicros(["1", "9", undefined, "1000000"]), "1000010");
  assert.equal(sumPointMicros([undefined]), undefined);
  assert.equal(pointMicrosToPoints("1000010"), 1.00001);
  assert.equal(pointMicrosToPoints("9".repeat(30)), undefined);
});
