import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { collectAccountReportFacts } from "../account-reports/account-report.facts.ts";
import { BehaviorService } from "./behavior.service.ts";
import { ErrorRecordsService } from "../error-records/error-records.service.ts";
import { predictionCalibration } from "../form-records/prediction-calibration.ts";
import { digest } from "../actions/action.validation.ts";
export async function collectBehaviorReportFacts(
  repo: LightTickRepository,
  o: LightTickOwner,
  days: number,
  now: Date,
) {
  return repo.transaction(o, async () => {
    const base = await collectAccountReportFacts(repo, o, days, now, {
        includeInvestments: false,
      }),
      applications = (
        await new BehaviorService(repo, () => now).list(o, {
          date_from: base.start,
          date_to: base.end,
        })
      ).stats,
      errors = (
        await new ErrorRecordsService(repo, () => now).list(o, {
          date_from: base.start,
          date_to: base.end,
        })
      ).stats,
      forms = (await repo.formRecords.get(o))?.data,
      predictions = predictionCalibration(
        (forms?.predictions ?? []).filter(
          (r) =>
            typeof r.date === "string" &&
            r.date >= base.start &&
            r.date <= base.end,
        ),
        0,
        {},
      );
    const behavior = {
      applications: {
        total: applications.total,
        rated_count: applications.rated_count,
        effectiveness_avg: applications.effectiveness_avg,
        top_concepts: applications.concepts,
      },
      errors: {
        total: errors.total,
        repeated: errors.repeated,
        repeat_rate: errors.repeat_rate,
      },
      predictions: {
        total: predictions.total,
        resolved: predictions.resolved,
        correct: predictions.correct,
        pending: predictions.pending,
        excluded: predictions.excluded,
        accuracy: predictions.accuracy,
        brier_score: predictions.brier_score,
      },
    };
    const additional = [
      ["behavior_applications", "行为应用记录", applications.total],
      ["behavior_rated", "本人已评分应用记录", applications.rated_count],
      ["behavior_errors", "错误记录", errors.total],
      ["behavior_repeated", "本人标记重复的错误", errors.repeated],
      [
        "behavior_predictions_resolved",
        "本期有效已结算预测",
        predictions.resolved,
      ],
      ["behavior_predictions_correct", "本期有效预测成立", predictions.correct],
    ] as const;
    const recordedDates = new Set([
      ...applications.daily.map((r) => r.date),
      ...errors.daily.map((r) => r.date),
      ...(forms?.predictions ?? [])
        .map((r) => r.date)
        .filter(
          (d): d is string =>
            typeof d === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(d) &&
            Number.isFinite(Date.parse(d)) &&
            new Date(d).toISOString().slice(0, 10) === d &&
            d >= base.start &&
            d <= base.end,
        ),
    ]);
    const facts = {
      ...base,
      active_days: recordedDates.size,
      behavior,
      metrics: [
        ...base.metrics.filter((m) => !m.key.startsWith("investment_")),
        ...additional.map(([key, label, count]) => ({
          key,
          label,
          count,
          date_basis: "本人记录日期，归档排除",
          coverage: "included" as const,
        })),
      ],
      limitations: [
        ...base.limitations,
        "本专题有记录天数仅对应用、错误与有有效日期的预测按日去重，不代表所有账户活动日。",
        "行为应用次数与本人效果评分不是客观效果证据；0分为未评分。归档应用/错误不纳入本期。",
        "仅单期聚合，不推断增长、下降、因果或能力变化。预测仅按原预测日期纳入；日期不明不分配到本期，未结算及无效字段不算失败。",
      ],
      digest: "",
    };
    facts.digest = digest({ ...facts, digest: undefined });
    return facts;
  });
}
