import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickDnaInsightRow, LightTickOwner } from "./lighttick.types.ts";
import { aggregateExecutionFacts, evaluateFeedbackRules } from "./lighttick-execution-facts.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";

/**
 * Phase 2 (W11-12): execution DNA insights.
 *
 * Promotion path: rule output (hypothesis >= 3 events, rule >= 7 stable events)
 * -> persisted DNAInsight with signature dedupe. Only the user's explicit
 * feedback (confirm) grants `allowed_effects`; low-confidence insights always
 * keep an empty effects list and can never change plans.
 */
const EFFECT_GRANT = ["scheduling", "variant", "recovery"];
const INSIGHT_TTL_MS = 30 * 86_400_000;
const SCOPE_BY_RULE: Record<string, string> = {
  "hypothesis.time_estimation_bias": "task_type",
  "rule.time_estimation_bias": "task_type",
  "hypothesis.best_slot": "time_slot",
  "hypothesis.consecutive_skips": "task_type",
};

export class LightTickDnaService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  /** Promote fresh rule outputs into DNA insights (idempotent by signature). */
  async synchronize(owner: LightTickOwner): Promise<LightTickDnaInsightRow[]> {
    const profile = await this.repository.getProfile(owner);
    const events = await this.repository.listExecutionEvents(owner);
    const facts = aggregateExecutionFacts(events, profile?.timezone ?? "Asia/Shanghai");
    const outputs = evaluateFeedbackRules(facts).filter(item => item.kind === "hypothesis" || item.kind === "rule");
    const timestamp = this.clock().toISOString();
    const expiresAt = new Date(this.clock().getTime() + INSIGHT_TTL_MS).toISOString();
    const saved: LightTickDnaInsightRow[] = [];
    for (const output of outputs) {
      const title = typeof output.facts.title === "string" ? output.facts.title : "general";
      const signature = `${output.ruleId}:${title}`;
      const existing = (await this.repository.listDnaInsights(owner)).find(insight => insight.signature === signature);
      if (existing && existing.status !== "proposed") continue;
      const confidence = output.kind === "rule"
        ? Math.min(0.9, 0.7 + Math.max(0, output.evidenceCount - 7) / 40)
        : Math.min(0.5, output.evidenceCount / 10);
      const row = await this.repository.saveDnaInsight(existing ? { ...existing, statement: output.message,
        kind: output.kind as "hypothesis" | "rule", evidenceCount: output.evidenceCount, dataRange: output.dataRange,
        confidence: Number(confidence.toFixed(2)), scope: SCOPE_BY_RULE[output.ruleId] ?? "general",
        expiresAt, updatedAt: timestamp } : { ...owner, id: randomId("lighttick_dna"), signature, ruleId: output.ruleId,
        statement: output.message, kind: output.kind as "hypothesis" | "rule", status: "proposed",
        evidenceCount: output.evidenceCount, dataRange: output.dataRange, confidence: Number(confidence.toFixed(2)),
        scope: SCOPE_BY_RULE[output.ruleId] ?? "general", allowedEffects: [], goalId: undefined,
        createdAt: timestamp, expiresAt, updatedAt: timestamp, version: 1 }, existing?.version);
      saved.push(row);
    }
    return saved;
  }

  /** User feedback is the only gate that grants effects or retires an insight. */
  async feedback(owner: LightTickOwner, insightId: string,
    action: "confirm" | "deny" | "correct" | "dismiss", correction?: string): Promise<LightTickDnaInsightRow> {
    const insight = await this.repository.getDnaInsight(owner, insightId);
    if (!insight) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "DNA insight was not found.");
    const timestamp = this.clock().toISOString();
    if (action === "dismiss") {
      // Dismiss only retires Today-feed suggestions; it never judges truth.
      if (!["proposed", "confirmed"].includes(insight.status))
        throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Insight is already decided.");
      return await this.repository.saveDnaInsight({ ...insight, status: "dismissed", updatedAt: timestamp }, insight.version);
    }
    if (insight.status !== "proposed")
      throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Insight is already decided.");
    if (action === "confirm") {
      if (insight.kind !== "rule") {
        // A confirmed hypothesis still needs evidence to become actionable.
        throw new ApplicationError(409, "LIGHTTICK_INSIGHT_NOT_ACTIONABLE",
          "Confirming a low-confidence hypothesis requires more evidence first.");
      }
      return await this.repository.saveDnaInsight({ ...insight, status: "confirmed",
        allowedEffects: EFFECT_GRANT, updatedAt: timestamp }, insight.version);
    }
    if (action === "deny") {
      return await this.repository.saveDnaInsight({ ...insight, status: "denied", updatedAt: timestamp }, insight.version);
    }
    if (action === "correct") {
      if (!correction || correction.trim().length < 2 || correction.trim().length > 500)
        throw new ApplicationError(400, "REQ_FIELD_INVALID", "correction is required.");
      return await this.repository.saveDnaInsight({ ...insight, status: "corrected",
        userFeedback: correction.trim(), updatedAt: timestamp }, insight.version);
    }
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "action is invalid.");
  }

  async list(owner: LightTickOwner, goalId?: string): Promise<LightTickDnaInsightRow[]> {
    return await this.repository.listDnaInsights(owner, goalId);
  }
}
