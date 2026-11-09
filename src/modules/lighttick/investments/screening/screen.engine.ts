import { shanghaiClock } from "../market/market.validation.ts";
import { setImmediate } from "node:timers/promises";
import { digest } from "../../learning/native-learning.validation.ts";
import {
  SCREEN_ALGORITHM,
  SCREEN_FIELDS,
  type ScreenInput,
  type FrozenSource,
  type Evaluation,
  type ScreenDetail,
  type Recipe,
  type ScreenReport,
} from "./screen.types.ts";
import {
  from,
  add,
  sub,
  mul,
  div,
  compare,
  rational,
  sum,
  mean,
  display,
  type Rational,
} from "./screen.rational.ts";
const recipeLabels: Record<string, string> = {
  exclude_is_st: "排除 ST",
  exclude_suspended: "排除停牌",
  history: "配方交易日窗口",
  ma5_gt_ma10_gt_ma20: "MA5 > MA10 > MA20",
  ma_slopes_positive: "均线斜率为正",
  recent_gain: "近期价格涨幅",
  pullback_range: "近5交易日回撤",
  above_ma20: "收盘不低于 MA20",
  shrinking_volume: "近3日缩量条件",
  volume_ratio: "前5交易日放量条件",
  near_window_high: "接近窗口高点",
  window_gain: "窗口价格变化",
  fields: "配方字段有效性",
};
const zero = from("0"),
  one = from("1"),
  hundred = from("100");
const max = (v: Rational[]) => v.reduce((a, b) => (compare(a, b) >= 0 ? a : b));
const min = (v: Rational[]) => v.reduce((a, b) => (compare(a, b) <= 0 ? a : b));
const reasons: Record<string, string> = {
  SESSION_INCOMPLETE: "目标交易日尚未完成",
  MISSING_SNAPSHOT: "未选择行情快照",
  CALENDAR_UNAVAILABLE: "日历未覆盖或已过复核期",
  NOT_SESSION: "目标日不是已核对交易日",
  PRICE_BASIS_UNKNOWN: "价格口径未知或不一致",
  MISSING_TARGET_BAR: "目标日行情缺失或过期",
  WINDOW_MISSING: "所需交易日记录不足",
  FIELDS_INVALID: "所需字段缺失或分母无效",
  STATUS_UNKNOWN: "缺少目标日已声明证券状态",
};
function sourceInfo(s: FrozenSource) {
  const m = s.snapshot;
  return {
    instrument_revision: s.instrument.revision,
    snapshot_id: m?.id ?? null,
    snapshot_revision: m?.revision ?? null,
    input_digest: m?.dataset.input_digest ?? null,
    supplier: m?.dataset.supplier ?? null,
    adapter_version: m?.dataset.adapter_version ?? null,
    calendar: m?.dataset.calendar ?? null,
    price_basis: m?.dataset.price_basis ?? null,
    available_at: m?.dataset.available_at ?? null,
    source_units: m?.dataset.source_units ?? null,
    security_status: s.security_status,
    security_status_independently_verified: false,
  };
}
function evaluate(s: FrozenSource, input: ScreenInput) {
  const m = s.snapshot,
    on = input.as_of,
    rule = input.rule.fields,
    calendar = m?.dataset.calendar as {
      status?: string;
      sessions?: Record<string, boolean>;
      review_until?: string;
    },
    byDate = new Map(
      (m?.dataset.bars ?? [])
        .filter((b) => b.date <= on)
        .map((b) => [b.date, b]),
    ),
    sessions = Object.entries(calendar?.sessions ?? {})
      .filter(([d, open]) => open === true && d <= on)
      .map(([d]) => d)
      .sort();
  const data: Record<
    string,
    { value: Rational | boolean | null; reason: string | null; dates: string[] }
  > = {};
  const decision = shanghaiClock(new Date(input.decision_at));
  const baseReason =
    on === decision.slice(0, 10) && decision.slice(11, 16) < "15:30"
      ? "SESSION_INCOMPLETE"
      : !m
        ? "MISSING_SNAPSHOT"
        : calendar?.status !== "available" ||
            (calendar.review_until &&
              decision.slice(0, 10) > calendar.review_until)
          ? "CALENDAR_UNAVAILABLE"
          : sessions.at(-1) !== on
            ? "NOT_SESSION"
            : m.dataset.price_basis !== "unadjusted"
              ? "PRICE_BASIS_UNKNOWN"
              : !byDate.has(on)
                ? "MISSING_TARGET_BAR"
                : null;
  for (const [field, meta] of Object.entries(SCREEN_FIELDS)) {
    const dates = sessions.slice(-meta.window);
    let reason = baseReason,
      value: Rational | boolean | null = null;
    if (
      !reason &&
      (dates.length < meta.window || dates.some((d) => !byDate.has(d)))
    )
      reason = "WINDOW_MISSING";
    if (!reason)
      try {
        const bars = dates.map((d) => byDate.get(d)!),
          last = bars.at(-1)!,
          read = (
            b: typeof last,
            k: "close" | "volume_shares" | "amount_cny" | "turnover_rate_pct",
          ) => {
            if (b[k] === null) throw Error("MISSING");
            return from(b[k]);
          };
        if (field === "close") value = read(last, "close");
        else if (field === "turnover_cny") value = read(last, "amount_cny");
        else if (field === "turnover_rate_pct")
          value = read(last, "turnover_rate_pct");
        else if (field.startsWith("return_"))
          value = mul(
            sub(div(read(last, "close"), read(bars[0], "close")), one),
            hundred,
          );
        else if (field.startsWith("avg_turnover_"))
          value = mean(bars.map((b) => read(b, "turnover_rate_pct")));
        else if (field.startsWith("avg_amount_"))
          value = mean(bars.map((b) => read(b, "amount_cny")));
        else if (field === "volume_ratio_5")
          value = div(
            mul(read(last, "volume_shares"), from("5")),
            sum(bars.slice(0, -1).map((b) => read(b, "volume_shares"))),
          );
        else
          value =
            compare(
              mul(read(last, "close"), from("20")),
              sum(bars.map((b) => read(b, "close"))),
            ) > 0;
      } catch {
        reason = "FIELDS_INVALID";
      }
    data[field] = { value, reason, dates };
  }
  const values = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k,
      v.value === null || typeof v.value === "boolean"
        ? v.value
        : display(v.value),
    ]),
  );
  const details: ScreenDetail[] = rule.conditions.map((c) => {
    const d = data[c.field];
    let result: boolean | null = null;
    if (d.value !== null) {
      const n =
        typeof d.value === "boolean"
          ? d.value === (c.value === "true")
            ? 0
            : d.value
              ? 1
              : -1
          : compare(d.value, from(c.value));
      result =
        c.op === "between"
          ? typeof d.value !== "boolean" &&
            compare(d.value, from(c.value)) >= 0 &&
            compare(d.value, from(c.upper_value)) <= 0
          : c.op === "eq"
            ? n === 0
            : c.op === "ne"
              ? n !== 0
              : c.op === "gt"
                ? n > 0
                : c.op === "gte"
                  ? n >= 0
                  : c.op === "lt"
                    ? n < 0
                    : n <= 0;
    }
    return {
      field: c.field,
      label: SCREEN_FIELDS[c.field].label,
      unit: SCREEN_FIELDS[c.field].unit,
      actual: values[c.field],
      result,
      reason: d.reason ? d.reason + ": " + reasons[d.reason] : null,
      dates: d.dates,
      condition: c,
    };
  });
  let outcomes = details.map((d) => d.result);
  let status: Evaluation["status"] = !outcomes.length
    ? data.close.value === null
      ? "unknown"
      : "matched"
    : rule.combine === "all"
      ? outcomes.includes(false)
        ? "excluded"
        : outcomes.includes(null)
          ? "unknown"
          : "matched"
      : outcomes.includes(true)
        ? "matched"
        : outcomes.includes(null)
          ? "unknown"
          : "excluded";
  if (rule.recipe) {
    const recipeDetails = evaluateRecipe(
      s,
      input,
      rule.recipe,
      baseReason,
      sessions,
      byDate,
    );
    details.push(...recipeDetails);
    const recipeValues = recipeDetails.map((d) => d.result);
    const recipeStatus = recipeValues.includes(false)
      ? "excluded"
      : recipeValues.includes(null)
        ? "unknown"
        : "matched";
    status =
      status === "excluded" || recipeStatus === "excluded"
        ? "excluded"
        : status === "unknown" || recipeStatus === "unknown"
          ? "unknown"
          : "matched";
  }
  const result: Evaluation = {
    instrument_id: s.instrument.id,
    code: s.instrument.code,
    market: s.instrument.market,
    name: s.instrument.name,
    status,
    values,
    details,
    sorting: [
      rule.sort_by,
      ...(rule.secondary_sort_by ? [rule.secondary_sort_by] : []),
    ].map((field) => ({
      field,
      label: SCREEN_FIELDS[field].label,
      unit: SCREEN_FIELDS[field].unit,
      actual: values[field],
      result: data[field].value === null ? null : true,
      reason: data[field].reason,
      dates: data[field].dates,
      condition: null,
    })),
    source: sourceInfo(s),
    limitations: [
      ...(m?.dataset.limitations ?? []),
      "行情为未复权历史日线；缺少公司行动、执行条件或证券状态不能确认可交易。",
      ...(m?.dataset.missing_sessions?.length
        ? ["快照包含缺失交易日，窗口逐项核对。"]
        : []),
    ],
  };
  return { result, data };
}
function evaluateRecipe(
  s: FrozenSource,
  input: ScreenInput,
  r: Recipe,
  baseReason: string | null,
  sessions: string[],
  byDate: Map<
    string,
    NonNullable<FrozenSource["snapshot"]>["dataset"]["bars"][number]
  >,
) {
  const details: ScreenDetail[] = [],
    required =
      r.kind === "ma_bullish"
        ? 21
        : r.kind === "pullback"
          ? Math.max(21, r.window)
          : r.kind === "volume_breakout"
            ? Math.max(6, r.window)
            : r.window + 1,
    dates = sessions.slice(-required);
  const addDetail = (
    field: string,
    result: boolean | null,
    reason: string | null = null,
    actual: string | boolean | null = null,
  ) =>
    details.push({
      field,
      label: recipeLabels[field] ?? field,
      unit: ["recent_gain", "pullback_range", "window_gain"].includes(field)
        ? "%"
        : "布尔",
      actual,
      result,
      reason: result === null ? reason : null,
      dates,
      condition: null,
    });
  for (const [field, enabled] of [
    ["is_st", r.exclude_st],
    ["suspended", r.exclude_suspended],
  ] as const)
    if (enabled) {
      const value =
        s.security_status?.as_of === input.as_of
          ? s.security_status[field]
          : null;
      addDetail(
        "exclude_" + field,
        typeof value === "boolean" ? !value : null,
        "STATUS_UNKNOWN: " + reasons.STATUS_UNKNOWN,
        value ?? null,
      );
    }
  if (
    baseReason ||
    dates.length !== required ||
    dates.some((d) => !byDate.has(d))
  ) {
    addDetail(
      "history",
      null,
      (baseReason ?? "WINDOW_MISSING") +
        ": 日历、未复权口径或连续交易日窗口缺失",
    );
    return details;
  }
  try {
    const bars = dates.map((d) => byDate.get(d)!),
      closes = bars.map((b) => from(b.close));
    if (closes.some((c) => compare(c, zero) <= 0)) throw Error();
    const volumes = ["pullback", "volume_breakout"].includes(r.kind)
      ? bars.map((b) => from(b.volume_shares))
      : [];
    if (volumes.some((v) => compare(v, zero) < 0)) throw Error();
    const ma = (n: number, offset = 0) =>
      mean(
        closes.slice(
          closes.length - n - offset,
          offset ? closes.length - offset : undefined,
        ),
      );
    if (["ma_bullish", "pullback"].includes(r.kind)) {
      addDetail(
        "ma5_gt_ma10_gt_ma20",
        compare(ma(5), ma(10)) > 0 && compare(ma(10), ma(20)) > 0,
      );
      addDetail(
        "ma_slopes_positive",
        [5, 10, 20].every((n) => compare(ma(n), ma(n, 1)) > 0),
      );
    }
    if (r.kind === "pullback") {
      const recent = closes.slice(-r.window),
        gain = mul(sub(div(max(recent), min(recent)), one), hundred),
        decline = mul(
          sub(one, div(closes.at(-1)!, max(closes.slice(-5)))),
          hundred,
        );
      addDetail(
        "recent_gain",
        compare(gain, from(r.minimum_gain)) >= 0,
        null,
        display(gain),
      );
      addDetail(
        "pullback_range",
        compare(decline, from(r.pullback_min)) >= 0 &&
          compare(decline, from(r.pullback_max)) <= 0,
        null,
        display(decline),
      );
      addDetail("above_ma20", compare(closes.at(-1)!, ma(20)) >= 0);
      const denominator = sum(volumes.slice(-13, -3));
      addDetail(
        "shrinking_volume",
        compare(denominator, zero) > 0
          ? compare(
              mean(volumes.slice(-3)),
              mul(div(denominator, from("10")), from(r.shrink_ratio)),
            ) < 0
          : null,
        "FIELDS_INVALID: 前期成交量为零",
      );
    } else if (r.kind === "volume_breakout") {
      const denominator = sum(volumes.slice(-6, -1));
      addDetail(
        "volume_ratio",
        compare(denominator, zero) > 0
          ? compare(
              volumes.at(-1)!,
              mul(div(denominator, from("5")), from(r.volume_ratio)),
            ) > 0
          : null,
        "FIELDS_INVALID: 前期成交量为零",
      );
      addDetail(
        "near_window_high",
        compare(
          closes.at(-1)!,
          mul(
            max(bars.slice(-r.window).map((b) => from(b.high))),
            from(r.near_high_ratio),
          ),
        ) >= 0,
      );
    } else if (r.kind === "return_window") {
      const gain = mul(
        sub(div(closes.at(-1)!, closes[closes.length - r.window - 1]), one),
        hundred,
      );
      addDetail(
        "window_gain",
        compare(gain, from(r.minimum_gain)) >= 0,
        null,
        display(gain),
      );
    }
  } catch {
    addDetail("fields", null, "FIELDS_INVALID: 价格、成交量或分母无效");
  }
  return details;
}
export async function screen(
  input: ScreenInput,
  signal?: AbortSignal,
): Promise<ScreenReport> {
  const pairs = [] as ReturnType<typeof evaluate>[];
  for (const s of input.sources) {
    signal?.throwIfAborted();
    pairs.push(evaluate(s, input));
    await setImmediate();
  }
  const rule = input.rule.fields,
    matched = pairs
      .filter((p) => p.result.status === "matched")
      .sort((a, b) => {
        for (const [field, desc] of [
          [rule.sort_by, rule.descending],
          [rule.secondary_sort_by, rule.secondary_descending],
        ] as const) {
          if (!field) continue;
          const x = a.data[field].value,
            y = b.data[field].value;
          if (x === null || y === null) {
            if (x !== y) return x === null ? 1 : -1;
            continue;
          }
          const c =
            typeof x === "boolean" && typeof y === "boolean"
              ? Number(x) - Number(y)
              : compare(x as Rational, y as Rational);
          if (c) return desc ? -c : c;
        }
        const x =
            a.result.market +
            ":" +
            a.result.code +
            ":" +
            a.result.instrument_id,
          y =
            b.result.market +
            ":" +
            b.result.code +
            ":" +
            b.result.instrument_id;
        return x < y ? -1 : x > y ? 1 : 0;
      });
  const result = {
    algorithm_version: SCREEN_ALGORITHM,
    input_digest: input.digest,
    as_of: input.as_of,
    decision_at: input.decision_at,
    items: matched.slice(0, rule.limit).map((p) => p.result),
    evaluations: pairs.map((p) => p.result),
    total: matched.length,
    unresolved: pairs.filter((p) => p.result.status === "unknown").length,
    incomplete: pairs.some(
      (p) =>
        p.result.details.some((d) => d.result === null) ||
        p.data[rule.sort_by].value === null ||
        (rule.secondary_sort_by &&
          p.data[rule.secondary_sort_by].value === null),
    ),
    limitations: [
      "只覆盖显式选择的股票池和冻结快照，不代表全市场。",
      "排序/比较使用精确有理数，展示值截至28位小数，显示值不回灌比较。",
      "证券状态为本人明确声明，未独立核验；命中不创建交易或行动。",
    ],
  };
  return { ...result, output_digest: digest(result) };
}
