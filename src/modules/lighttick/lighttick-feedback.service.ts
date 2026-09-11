import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner, LightTickTaskRow } from "./lighttick.types.ts";
import { aggregateExecutionFacts, buildSingleCompletionFeedback,
  evaluateFeedbackRules, type LightTickFactFeedback } from "./lighttick-execution-facts.ts";
import { randomId } from "../../shared/utils.ts";

/**
 * Phase 2 (W9-10): factual feedback and rule outputs over the execution event
 * stream. Every output is appended to the insight audit trail (kind: factual |
 * hypothesis | rule). Private notes are never copied into audit output.
 */
export class LightTickFeedbackService {
  constructor(
    private readonly repository: LightTickRepository,
    private readonly timezoneOf: (owner: LightTickOwner) => Promise<string>,
    private readonly clock = () => new Date(),
  ) {}

  /** Factual feedback for one fresh completion; audit-only, never a stable claim. */
  async singleCompletionFeedback(owner: LightTickOwner, task: LightTickTaskRow,
    actualMinutes: number, completedAt = this.clock().toISOString()): Promise<LightTickFactFeedback> {
    const feedback = buildSingleCompletionFeedback({
      id: task.id, title: task.title, estimatedMinutes: task.estimatedMinutes,
      selectedVariant: task.selectedVariant ?? "standard",
    }, actualMinutes, completedAt);
    await this.repository.appendInsightAudit({ ...owner, id: randomId("lighttick_audit"), ruleId: feedback.ruleId,
      kind: feedback.kind, evidenceCount: feedback.evidenceCount,
      evidenceWindow: feedback.dataRange, output: feedback.facts, createdAt: completedAt });
    return feedback;
  }

  /** Evaluate baseline rules over the user's execution history (windowed). */
  async evaluate(owner: LightTickOwner, from?: string, to?: string): Promise<{ facts: ReturnType<typeof aggregateExecutionFacts>; feedback: LightTickFactFeedback[] }> {
    const timezone = await this.timezoneOf(owner);
    const events = await this.repository.listExecutionEvents(owner, from, to);
    const facts = aggregateExecutionFacts(events, timezone);
    const feedback = evaluateFeedbackRules(facts);
    const now = this.clock().toISOString();
    for (const item of feedback) {
      await this.repository.appendInsightAudit({ ...owner, id: randomId("lighttick_audit"), ruleId: item.ruleId,
        kind: item.kind, evidenceCount: item.evidenceCount, evidenceWindow: item.dataRange,
        output: item.facts, createdAt: now });
    }
    return { facts, feedback };
  }

  async listAudits(owner: LightTickOwner, from?: string, to?: string) {
    return await this.repository.listInsightAudits(owner, from, to);
  }
}

/** Deterministic timezone resolver bound to a profile store. */
export function profileTimezoneResolver(repository: LightTickRepository) {
  return async (owner: LightTickOwner): Promise<string> => {
    const profile = await repository.getProfile(owner);
    return profile?.timezone ?? "Asia/Shanghai";
  };
}
