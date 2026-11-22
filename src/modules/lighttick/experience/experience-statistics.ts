import { experienceTextOrder } from "./experience-projections.ts";
import { Decimal } from "decimal.js";
import type {
  ApplicationData,
  ErrorData,
  ExperienceObject,
  ExperienceAggregate,
} from "./experience.types.ts";
export function memoryExperienceAggregate(
  rows: ExperienceObject[],
  start: string,
  end: string,
): ExperienceAggregate[] {
  const known = rows.filter((r) => {
      const d = r.data as ApplicationData;
      return d.date && d.date >= start && d.date <= end;
    }),
    metrics: ExperienceAggregate = {
      kind: "metrics",
      key: null,
      count: known.length,
      unknown_date: rows.filter(
        (r) => (r.data as ApplicationData).date === null,
      ).length,
      severity_sum: 0,
      severity_known: 0,
      repeat_true: 0,
      repeat_known: 0,
      effectiveness_sum: 0,
      effectiveness_known: 0,
      effectiveness_unrated: 0,
    };
  const groups = new Map<string, ExperienceAggregate>();
  for (const r of known) {
    const d = r.data as ApplicationData & ErrorData;
    for (const [kind, key] of [
      ["module", d.module_id],
      ["day", d.date],
      [
        r.kind === "application" ? "concept" : "type",
        r.kind === "application" ? d.concept : d.error_type,
      ],
    ] as const) {
      const id = JSON.stringify([kind, key]);
      const g = groups.get(id) ?? { kind, key, count: 0 };
      g.count++;
      groups.set(id, g);
    }
    if (r.kind === "error") {
      if (d.severity !== null) {
        metrics.severity_known!++;
        metrics.severity_sum! += d.severity;
      }
      if (d.is_repeat !== null) {
        metrics.repeat_known!++;
        if (d.is_repeat) metrics.repeat_true!++;
      }
    } else if (d.effectiveness === 0) metrics.effectiveness_unrated!++;
    else if (d.effectiveness !== null) {
      metrics.effectiveness_known!++;
      metrics.effectiveness_sum! += d.effectiveness;
    }
  }
  return [metrics, ...groups.values()];
}
export function experienceStatistics(
  groups: ExperienceAggregate[],
  start: string,
  end: string,
) {
  if (groups.length > 10000) throw Error("Statistics capacity exceeded");
  const m = groups.find((g) => g.kind === "metrics")!;
  const by = (kind: ExperienceAggregate["kind"]) =>
    groups
      .filter((g) => g.kind === kind)
      .sort(
        (a, b) =>
          b.count - a.count || experienceTextOrder(a.key ?? "", b.key ?? ""),
      );
  const days = new Map(by("day").map((g) => [g.key, g.count])),
    trend: { date: string; count: number }[] = [];
  for (
    let time = Date.parse(start + "T00:00:00Z");
    time <= Date.parse(end + "T00:00:00Z");
    time += 86400000
  ) {
    const date = new Date(time).toISOString().slice(0, 10);
    trend.push({ date, count: days.get(date) ?? 0 });
  }
  const ratio = (sum: number, n: number, places: number) =>
    n ? new Decimal(sum).div(n).toFixed(places, Decimal.ROUND_HALF_UP) : null;
  return {
    formula_version: "experience-confirmed-v1",
    timezone: "Asia/Shanghai",
    start,
    end,
    period_days: trend.length,
    total: m.count,
    unknown_date: m.unknown_date ?? 0,
    by_module: by("module").map((g) => ({ module_id: g.key, count: g.count })),
    by_type: by("type").map((g) => ({ error_type: g.key, count: g.count })),
    top_concepts: by("concept")
      .slice(0, 5)
      .map((g) => ({ concept: g.key, count: g.count })),
    severity: {
      average: ratio(m.severity_sum ?? 0, m.severity_known ?? 0, 1),
      known: m.severity_known ?? 0,
      unknown: m.count - (m.severity_known ?? 0),
    },
    repeat: {
      rate: ratio(m.repeat_true ?? 0, m.repeat_known ?? 0, 2),
      marked: m.repeat_true ?? 0,
      known: m.repeat_known ?? 0,
      unknown: m.count - (m.repeat_known ?? 0),
    },
    effectiveness: {
      average: ratio(m.effectiveness_sum ?? 0, m.effectiveness_known ?? 0, 1),
      rated: m.effectiveness_known ?? 0,
      unrated: m.effectiveness_unrated ?? 0,
      unknown:
        m.count - (m.effectiveness_known ?? 0) - (m.effectiveness_unrated ?? 0),
    },
    trend,
  };
}
