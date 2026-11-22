import { test } from "node:test";
import assert from "node:assert/strict";
import { predictionCalibration } from "../../src/modules/lighttick/form-records/prediction-calibration.ts";
const row = (probability: unknown, result: unknown, date = "2026-11-15") => ({
  date,
  statement: "明确的预测",
  probability,
  result,
});
test("calibration counts only explicit valid outcomes, includes 100% and keeps empty denominators unknown", () => {
  const r = predictionCalibration(
    [
      row(100, "incorrect"),
      row("80", "correct"),
      row(0, "incorrect"),
      row(50, "pending"),
      row("", "correct"),
      row(80, "也许"),
      row(101, "correct"),
      row(40, "correct", "2026-02-30"),
    ],
    7,
    {},
  );
  assert.deepEqual([r.total, r.resolved, r.pending, r.excluded], [8, 3, 1, 4]);
  assert.equal(r.accuracy, 1 / 3);
  assert.ok(Math.abs(r.brier_score! - (1 + 0.04) / 3) < 1e-12);
  assert.equal(r.buckets[9].count, 1);
  assert.equal(r.buckets[9].rate, 0);
  assert.equal(r.buckets[1].rate, null);
  assert.equal(r.source_revision, 7);
  assert.equal(r.high_confidence.items.length, 1);
  assert.equal(r.high_confidence.items[0].source_index, 0);
  const empty = predictionCalibration([], 0, {});
  assert.equal(empty.accuracy, null);
  assert.equal(empty.brier_score, null);
  assert.equal(empty.calibration_gap, null);
});
test("trend uses date/source order, window bounds and independent bounded result pages", () => {
  const rows = Array.from({ length: 55 }, (_, i) =>
    row(
      i % 2 ? 80 : 100,
      i % 2 ? "correct" : "incorrect",
      "2026-11-" + String(1 + (i % 15)).padStart(2, "0"),
    ),
  );
  const r = predictionCalibration(rows, 2, {
    window: "3",
    trend_page: "2",
    page: "2",
  });
  assert.equal(r.trend.total, 53);
  assert.equal(r.trend.items.length, 3);
  assert.equal(r.high_confidence.total, 28);
  assert.equal(r.high_confidence.items.length, 8);
  assert.equal(r.high_confidence.page, 2);
  assert.equal(r.trend.items[0].window_size, 3);
  assert.deepEqual(rows[0], row(100, "incorrect", "2026-11-01"));
  for (const q of [
    { window: "2" },
    { threshold: "49" },
    { page: "0" },
    { q: "unexpected" },
  ])
    assert.throws(() => predictionCalibration([], 0, q), { statusCode: 422 });
});
import { predictionSource } from "../../src/modules/lighttick/form-records/prediction-calibration.ts";
test("source review refuses stale row indexes and never rewrites original legacy input", () => {
  const rows = [row(80, "correct")];
  assert.equal(
    predictionSource(rows, 4, { revision: "4", index: "0" }).row.statement,
    "明确的预测",
  );
  assert.throws(
    () => predictionSource(rows, 5, { revision: "4", index: "0" }),
    { statusCode: 409 },
  );
  assert.throws(() => predictionSource(rows, 4, { index: "0" }), {
    statusCode: 422,
  });
  assert.throws(
    () => predictionSource(rows, 4, { revision: "4", index: "1" }),
    { statusCode: 404 },
  );
});
test("untrusted legacy result objects are excluded without coercion or mutation", () => {
  const rows = [
    row(80, { toString: "not-callable" }),
    row(true, "correct"),
    row(null, "correct"),
  ];
  assert.equal(predictionCalibration(rows, 1, {}).excluded, 3);
  assert.deepEqual(rows[0].result, { toString: "not-callable" });
});
