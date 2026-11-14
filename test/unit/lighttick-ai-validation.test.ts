import test from "node:test";
import assert from "node:assert/strict";
import { validateReviewOutput } from "../../src/modules/lighttick/ai/lighttick-ai-validation.ts";

// 合同 LightTickReviewActionView.recommendations 是 oneOf[string, object]，
// insights 是 string[]。校验必须与合同一致：过严会让真实模型输出被判 502
// 并整体降级 facts_only，过松会让下游 normalizeReviewRecommendations 收到垃圾。
test("review output accepts string recommendations (legacy shape)", () => {
  const output = { insights: ["本周完成 3 件"], recommendations: ["下周减少并发"] };
  assert.deepEqual(validateReviewOutput(output), output);
});

test("review output accepts object recommendations (contract oneOf object)", () => {
  const output = {
    insights: ["本周完成 3 件"],
    recommendations: [
      { title: "下周减少并发", detail: "同时推进超过 2 件导致延期", action: "adjust_pace" },
    ],
  };
  assert.deepEqual(validateReviewOutput(output), output);
});

test("review output accepts a mix of string and object recommendations", () => {
  const output = {
    insights: ["本周完成 3 件"],
    recommendations: ["保持当前节奏", { title: "减少并发" }],
  };
  assert.deepEqual(validateReviewOutput(output), output);
});

test("review output still rejects non-string insights", () => {
  assert.throws(
    () => validateReviewOutput({ insights: [{ text: "本周完成 3 件" }], recommendations: [] }),
    { statusCode: 502, message: "AI review output does not match its schema." },
  );
});

test("review output rejects recommendation items that are neither string nor object", () => {
  for (const bad of [42, null, true, ["nested"]]) {
    assert.throws(
      () => validateReviewOutput({ insights: [], recommendations: [bad] }),
      { statusCode: 502 },
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test("review output rejects non-array containers", () => {
  assert.throws(
    () => validateReviewOutput({ insights: "done", recommendations: [] }),
    { statusCode: 502 },
  );
  assert.throws(
    () => validateReviewOutput({ insights: [], recommendations: { title: "x" } }),
    { statusCode: 502 },
  );
});
