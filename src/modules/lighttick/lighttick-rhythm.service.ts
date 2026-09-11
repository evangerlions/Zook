import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickDnaInsightRow, LightTickOwner, LightTickTaskRow } from "./lighttick.types.ts";
import { LightTickTodayService } from "./lighttick-today.service.ts";
import { LightTickDnaService } from "./lighttick-dna.service.ts";
import { ApplicationError } from "../../shared/errors.ts";

/**
 * Phase 2 (W15): Today rhythm suggestion.
 *
 * Derives at most one actionable suggestion for today from *confirmed* DNA
 * insights (the only insights with granted effects). The suggestion matches
 * today's executable tasks; nothing below the user-confirmed bar may speak
 * into Today. `dismiss` retires the insight from this feed without judging it.
 */

export interface RhythmSuggestion {
  insightId: string; ruleId: string; kind: string; statement: string;
  confidence: number; evidenceCount: number; scope: string;
  task: { id: string; title: string; estimated_minutes: number; selected_variant: string };
  action: string;
}

export interface RhythmSuggestionResult {
  suggestion?: RhythmSuggestion;
  reason?: "no_today_tasks" | "no_confirmed_insight" | "no_matching_task";
}

function titleOfSignature(signature: string): string {
  const separator = signature.indexOf(":");
  return separator < 0 ? signature : signature.slice(separator + 1);
}

export class LightTickRhythmSuggestionService {
  constructor(private readonly repository: LightTickRepository,
    private readonly dna = new LightTickDnaService(repository), private readonly clock = () => new Date()) {}

  async suggest(owner: LightTickOwner): Promise<RhythmSuggestionResult> {
    const today = await new LightTickTodayService(this.repository, this.clock).get(owner);
    const executable = today.executableTasks;
    if (executable.length === 0) return { reason: "no_today_tasks" };
    const insights = (await this.repository.listDnaInsights(owner)).filter(insight => insight.status === "confirmed");
    if (insights.length === 0) return { reason: "no_confirmed_insight" };
    for (const insight of insights) {
      const title = titleOfSignature(insight.signature);
      const task = executable.find(candidate => candidate.title === title)
        ?? executable.find(candidate => candidate.title.includes(title) || title.includes(candidate.title));
      if (!task) continue;
      if (insight.ruleId === "rule.time_estimation_bias") {
        const action = this.estimationAction(insight, task);
        if (!action) continue;
        return { suggestion: { insightId: insight.id, ruleId: insight.ruleId, kind: insight.kind,
          statement: insight.statement, confidence: insight.confidence, evidenceCount: insight.evidenceCount,
          scope: insight.scope, task: { id: task.id, title: task.title, estimated_minutes: task.estimatedMinutes,
            selected_variant: task.selectedVariant ?? "standard" },
          action } };
      }
    }
    return { reason: "no_matching_task" };
  }

  /** Accept records intent on the insight; dismiss retires the feed entry. */
  async feedback(owner: LightTickOwner, insightId: string,
    action: "accept" | "dismiss"): Promise<LightTickDnaInsightRow> {
    if (action === "dismiss") return await this.dna.feedback(owner, insightId, "dismiss");
    const insight = await this.repository.getDnaInsight(owner, insightId);
    if (!insight) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "DNA insight was not found.");
    if (insight.status !== "confirmed")
      throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Only confirmed insights can be accepted.");
    return await this.repository.saveDnaInsight({ ...insight, userFeedback: "accepted_for_today",
      updatedAt: this.clock().toISOString() }, insight.version);
  }

  private estimationAction(insight: LightTickDnaInsightRow, task: LightTickTaskRow): string | undefined {
    const deviation = insight.evidence?.deviation_minutes;
    if (typeof deviation !== "number" || !Number.isFinite(deviation) || deviation === 0) return undefined;
    return deviation > 0
      ? `你通常低估“${task.title}”需要的时长（${insight.evidenceCount} 次样本）。开始前建议把预计时长上调，或选更轻松的版本。`
      : `你通常高估“${task.title}”需要的时长（${insight.evidenceCount} 次样本）。可以根据实际耗时适当下调预计时长。`;
  }
}
