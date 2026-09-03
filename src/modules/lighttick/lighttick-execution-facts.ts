import type { LightTickExecutionEventRow } from "./lighttick.types.ts";

/**
 * Phase 2 (W9-10): evidence-driven execution facts.
 *
 * This module is deliberately pure: it turns append-only execution events into
 * structured facts and evaluates deterministic baseline rules. No IO, no
 * provider calls. Rules must never emit a stable preference from a single
 * event; only the `factual` kind may appear below the 3-event threshold.
 */

export type LightTickFeedbackKind = "factual" | "hypothesis" | "rule";

export interface LightTickFactFeedback {
  /** Stable rule id so clients and audit logs can correlate. */
  ruleId: string;
  kind: LightTickFeedbackKind;
  /** Human-oriented, conclusion-first sentence. No stable personality claims. */
  message: string;
  /** Structured facts that support this output. */
  facts: Record<string, unknown>;
  /** Number of distinct valid events backing this output. */
  evidenceCount: number;
  /** Earliest/latest event timestamps used, UTC ISO. */
  dataRange: { from: string; to: string };
  /** Never persisted into DNA; evaluated again on each read. */
  confident: boolean;
}

export interface LightTickExecutionFacts {
  /** Completed task events inside the window (valid_action only). */
  completedCount: number;
  /** Average |actual - estimated| in minutes across completions. */
  averageDeviationMinutes: number;
  /** Estimation bias per lineage group: actual - estimated total minutes. */
  byLineage: Record<string, { title: string; count: number; totalEstimatedMinutes: number;
    totalActualMinutes: number; deviationMinutes: number; consistentDirection: boolean }>;
  /** Completion slot performance per local hour (0-23). */
  bySlot: Record<number, { count: number; averageDeviationMinutes: number }>;
  /** Consecutive skips observed for the same lineage. */
  maxConsecutiveSkipsByLineage: Record<string, { title: string; count: number }>;
  window: { from: string; to: string };
}

const MINUTES_PER_DAY = 86_400_000;

function localHourOf(iso: string, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false });
  const hour = Number(formatter.format(new Date(iso)));
  return hour === 24 ? 0 : hour;
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isCompletionEvent(event: LightTickExecutionEventRow): boolean {
  return event.eventType === "task_completed"
    && event.payload.action === "complete"
    && payloadNumber(event.payload, "actual_minutes") !== undefined
    && event.payload.valid_action !== false;
}

/** Aggregate append-only events into windowed execution facts (pure). */
export function aggregateExecutionFacts(events: LightTickExecutionEventRow[], timezone: string): LightTickExecutionFacts {
  const completions = events.filter(isCompletionEvent);
  const byLineage: LightTickExecutionFacts["byLineage"] = {};
  const bySlot: LightTickExecutionFacts["bySlot"] = {};
  const biasDirection: Record<string, number> = {};
  let deviationSum = 0;
  let from = "";
  let to = "";
  for (const event of completions) {
    const estimated = payloadNumber(event.payload, "estimated_minutes");
    const actual = payloadNumber(event.payload, "actual_minutes") ?? 0;
    const deviation = estimated === undefined ? 0 : actual - estimated;
    const lineage = payloadString(event.payload, "lineage_id") ?? payloadString(event.payload, "task_id") ?? "unknown";
    const title = payloadString(event.payload, "title") ?? lineage;
    const slot = localHourOf(event.occurredAt, timezone);
    if (!from || event.occurredAt < from) from = event.occurredAt;
    if (!to || event.occurredAt > to) to = event.occurredAt;
    const group = byLineage[lineage] ?? { title, count: 0, totalEstimatedMinutes: 0, totalActualMinutes: 0,
      deviationMinutes: 0, consistentDirection: true };
    group.count += 1;
    group.totalEstimatedMinutes += estimated ?? actual;
    group.totalActualMinutes += actual;
    group.deviationMinutes += deviation;
    const direction = Math.sign(deviation);
    if (direction !== 0) {
      const previous = biasDirection[lineage];
      if (previous === undefined) biasDirection[lineage] = direction;
      else if (previous !== direction) group.consistentDirection = false;
    }
    byLineage[lineage] = group;
    const slotGroup = bySlot[slot] ?? { count: 0, averageDeviationMinutes: 0 };
    slotGroup.count += 1;
    slotGroup.averageDeviationMinutes = ((slotGroup.averageDeviationMinutes * (slotGroup.count - 1)) + deviation) / slotGroup.count;
    bySlot[slot] = slotGroup;
    deviationSum += Math.abs(deviation);
  }
  const completedCount = completions.length;
  return {
    completedCount,
    averageDeviationMinutes: completedCount === 0 ? 0 : deviationSum / completedCount,
    byLineage,
    bySlot,
    maxConsecutiveSkipsByLineage: maxConsecutiveSkips(events),
    window: { from, to },
  };
}

function maxConsecutiveSkips(events: LightTickExecutionEventRow[]): LightTickExecutionFacts["maxConsecutiveSkipsByLineage"] {
  const ordered = [...events]
    .filter(event => event.eventType === "task_skipped" && event.payload.action === "skip")
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const running: Record<string, { title: string; count: number; best: number; lastAt: string }> = {};
  const result: LightTickExecutionFacts["maxConsecutiveSkipsByLineage"] = {};
  for (const event of ordered) {
    const lineage = payloadString(event.payload, "lineage_id") ?? payloadString(event.payload, "task_id") ?? "unknown";
    const title = payloadString(event.payload, "title") ?? lineage;
    const previous = running[lineage];
    const wasInterrupted = previous !== undefined
      && Date.parse(event.occurredAt) - Date.parse(previous.lastAt) < 7 * MINUTES_PER_DAY;
    const count = wasInterrupted ? previous.count + 1 : 1;
    const best = Math.max(wasInterrupted ? previous.best : 0, count);
    running[lineage] = { title, count, best, lastAt: event.occurredAt };
    if (best > (result[lineage]?.count ?? 0)) result[lineage] = { title, count: best };
  }
  return result;
}

function windowOf(facts: LightTickExecutionFacts): { from: string; to: string } {
  return facts.window.from && facts.window.to ? facts.window : { from: new Date(0).toISOString(), to: new Date(0).toISOString() };
}

/**
 * Evaluate deterministic baseline rules over facts.
 * - `factual` outputs never infer stable preferences (single-event safe).
 * - `hypothesis` needs >= 3 same-type events and always states confidence.
 * - `rule` outputs are confirmed baselines only (>= 7 events, stable).
 */
export function evaluateFeedbackRules(facts: LightTickExecutionFacts): LightTickFactFeedback[] {
  const outputs: LightTickFactFeedback[] = [];
  const range = windowOf(facts);

  if (facts.completedCount === 1) {
    const group = Object.values(facts.byLineage)[0];
    if (group) {
      outputs.push({
        ruleId: "fact.single_completion", kind: "factual",
        message: `这次预计 ${group.totalEstimatedMinutes} 分钟，实际用了 ${group.totalActualMinutes} 分钟。`,
        facts: { title: group.title, estimated_minutes: group.totalEstimatedMinutes, actual_minutes: group.totalActualMinutes },
        evidenceCount: 1, dataRange: range, confident: false,
      });
    }
    return outputs;
  }

  const lineageGroups = Object.values(facts.byLineage).filter(group => group.count >= 3);
  for (const group of lineageGroups) {
    const deviation = group.totalActualMinutes - group.totalEstimatedMinutes;
    const ratio = group.totalEstimatedMinutes > 0 ? deviation / group.totalEstimatedMinutes : 0;
    const kind: LightTickFeedbackKind = group.count >= 7 && group.consistentDirection ? "rule" : "hypothesis";
    const direction = deviation > 5 ? "低估了自己" : deviation < -5 ? "高估了自己" : "估算比较准";
    outputs.push({
      ruleId: kind === "rule" ? "rule.time_estimation_bias" : "hypothesis.time_estimation_bias", kind,
      message: kind === "rule"
        ? `同类任务时间估算规律（${group.count} 次样本）：${direction}，偏差 ${Math.abs(deviation)} 分钟。`
        : `同类任务时间估算倾向（${group.count} 次样本，低置信度）：${direction}。`,
      facts: { title: group.title, count: group.count, deviation_minutes: deviation, ratio, consistent_direction: group.consistentDirection },
      evidenceCount: group.count, dataRange: range, confident: kind === "rule",
    });
  }

  const slots = Object.entries(facts.bySlot).filter(([, group]) => group.count >= 3)
    .sort((a, b) => b[1].count - a[1].count);
  if (slots.length > 0) {
    const [bestSlot, bestGroup] = slots[0]!;
    outputs.push({
      ruleId: "hypothesis.best_slot", kind: "hypothesis",
      message: `你常在 ${bestSlot}:00 前后完成任务（${bestGroup.count} 次样本，低置信度）。`,
      facts: { slot: Number(bestSlot), count: bestGroup.count, average_deviation_minutes: bestGroup.averageDeviationMinutes },
      evidenceCount: bestGroup.count, dataRange: range, confident: false,
    });
  }

  const skipGroups = Object.entries(facts.maxConsecutiveSkipsByLineage).filter(([, group]) => group.count >= 2);
  for (const [, group] of skipGroups) {
    outputs.push({
      ruleId: "hypothesis.consecutive_skips", kind: "hypothesis",
      message: `“${group.title}”连续 ${group.count} 次被跳过，可能是阻力点（低置信度）。`,
      facts: { title: group.title, count: group.count },
      evidenceCount: group.count, dataRange: range, confident: false,
    });
  }

  return outputs;
}

/** Deterministic factual feedback for a single fresh completion (audit-only). */
export function buildSingleCompletionFeedback(
  task: { id: string; title: string; estimatedMinutes: number; selectedVariant?: string },
  actualMinutes: number,
  completedAt: string,
): LightTickFactFeedback {
  const deviation = actualMinutes - task.estimatedMinutes;
  const message = deviation > 5
    ? `这次预计 ${task.estimatedMinutes} 分钟，实际用了 ${actualMinutes} 分钟。`
    : deviation < -5
      ? `这次预计 ${task.estimatedMinutes} 分钟，实际只用了 ${actualMinutes} 分钟。`
      : `这次预计 ${task.estimatedMinutes} 分钟，实际用了 ${actualMinutes} 分钟。`;
  return {
    ruleId: "fact.single_completion", kind: "factual",
    message,
    facts: { task_id: task.id, title: task.title, estimated_minutes: task.estimatedMinutes,
      actual_minutes: actualMinutes, selected_variant: task.selectedVariant ?? "standard" },
    evidenceCount: 1, dataRange: { from: completedAt, to: completedAt }, confident: false,
  };
}
