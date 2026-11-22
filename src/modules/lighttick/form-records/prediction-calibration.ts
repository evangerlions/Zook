import { fail } from "../learning/native-learning.validation.ts";
type Query = Record<string, string | undefined>;
export function calibrationNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (value === undefined) return fallback;
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  )
    fail(422, "预测回看参数无效。");
  return Number(value);
}
function normalize(r: Record<string, unknown>, source_index: number) {
  const date = r.date,
    statement = r.statement,
    p = r.probability,
    result = typeof r.result === "string" ? r.result.trim() : r.result;
  const probability =
    typeof p === "number"
      ? p
      : typeof p === "string" && /^\d+(?:\.\d+)?$/.test(p.trim())
        ? Number(p)
        : NaN;
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date + "T00:00:00Z")) ||
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date ||
    typeof statement !== "string" ||
    !statement.trim() ||
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 100 ||
    typeof result !== "string" ||
    !["", "pending", "correct", "incorrect"].includes(result)
  )
    return null;
  return {
    source_index,
    date,
    statement,
    probability,
    result:
      result === ""
        ? "pending"
        : (result as "pending" | "correct" | "incorrect"),
  };
}
export function predictionSource(
  rows: Record<string, unknown>[],
  revision: number,
  q: Query,
) {
  if (
    Object.keys(q).some((k) => !["revision", "index"].includes(k)) ||
    q.revision === undefined ||
    q.index === undefined
  )
    fail(422, "请保留来源版本和序号。");
  const expected = calibrationNumber(q.revision, 0, 0, 2147483647),
    index = calibrationNumber(q.index, 0, 0, 4999);
  if (expected !== revision) fail(409, "预测记录已变化，请刷新校准回看。");
  const row = rows[index] && normalize(rows[index], index);
  if (!row) fail(404, "该预测来源不可用。");
  return { source_revision: revision, row };
}
export function predictionCalibration(
  rows: Record<string, unknown>[],
  revision: number,
  q: Query,
) {
  if (
    Object.keys(q).some(
      (k) => !["threshold", "window", "page", "trend_page"].includes(k),
    )
  )
    fail(422, "预测回看参数无效。");
  const threshold = calibrationNumber(q.threshold, 80, 50, 100),
    window = calibrationNumber(q.window, 10, 3, 50),
    page = calibrationNumber(q.page, 1, 1, 1000000),
    trendPage = calibrationNumber(q.trend_page, 1, 1, 1000000);
  const valid = rows.map(normalize).filter((r) => r !== null),
    resolved = valid
      .filter((r) => r.result !== "pending")
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.source_index - b.source_index,
      ),
    n = resolved.length,
    correct = resolved.filter((r) => r.result === "correct").length;
  const buckets = Array.from({ length: 10 }, (_, index) => {
    const group = resolved.filter(
        (r) => Math.min(9, Math.floor(r.probability / 10)) === index,
      ),
      count = group.length,
      yes = group.filter((r) => r.result === "correct").length,
      mean = count
        ? group.reduce((s, r) => s + r.probability / 100, 0) / count
        : null;
    return {
      min: index * 10,
      max: (index + 1) * 10,
      count,
      correct: yes,
      mean_probability: mean,
      rate: count ? yes / count : null,
    };
  });
  const high = resolved
    .filter((r) => r.probability >= threshold && r.result === "incorrect")
    .sort(
      (a, b) =>
        b.probability - a.probability ||
        b.date.localeCompare(a.date) ||
        a.source_index - b.source_index,
    )
    .map((r) => ({
      ...r,
      statement: r.statement.slice(0, 500),
      truncated: r.statement.length > 500,
    }));
  const trend = Array.from({ length: Math.max(0, n - window + 1) }, (_, i) => {
    const group = resolved.slice(i, i + window);
    return {
      index: i + 1,
      date: group.at(-1)!.date,
      accuracy: group.filter((r) => r.result === "correct").length / window,
      window_size: window,
    };
  });
  const slice = <T>(items: T[], requested: number, size: number) => {
    const page = Math.min(
      requested,
      Math.max(1, Math.ceil(items.length / size)),
    );
    return {
      items: items.slice((page - 1) * size, page * size),
      total: items.length,
      page,
      page_size: size,
    };
  };
  return {
    source_revision: revision,
    total: rows.length,
    resolved: n,
    pending: valid.length - n,
    excluded: rows.length - valid.length,
    correct,
    accuracy: n ? correct / n : null,
    brier_score: n
      ? resolved.reduce(
          (s, r) =>
            s + (r.probability / 100 - (r.result === "correct" ? 1 : 0)) ** 2,
          0,
        ) / n
      : null,
    avg_probability: n
      ? resolved.reduce((s, r) => s + r.probability / 100, 0) / n
      : null,
    calibration_gap: n
      ? buckets.reduce(
          (s, b) =>
            s + b.count * Math.abs((b.rate ?? 0) - (b.mean_probability ?? 0)),
          0,
        ) / n
      : null,
    buckets,
    threshold,
    window,
    high_confidence: slice(high, page, 20),
    trend: slice(trend, trendPage, 50),
  };
}
