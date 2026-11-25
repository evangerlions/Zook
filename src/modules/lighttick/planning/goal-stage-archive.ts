import { ApplicationError } from "../../../shared/errors.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { readGoalRoadmap } from "./goal-roadmap.ts";

/**
 * Read-only stage archive aggregation (connect-stage-outcomes-to-clients 2.1, design.md 决策 3 案 B).
 *
 * Storage facts that shape this service (evidence/task-0.3-0.4-storage-and-clients.md):
 * - `zook_lighttick_outcome_evidence` forces `metric IS NOT NULL` on stage rows, so only measured
 *   outcomes live there. Lessons, records and form self-assessments must be joined at read time.
 * - Only the outcome-evidence table is goal+stage scoped. Lessons, records and form records are
 *   account-scoped and carry a calendar date, so they can only be attributed by the stage date
 *   window. A stage without dates has no window, and those three sources are then reported as
 *   missing rather than dumped from the whole account history.
 *
 * This service never writes, never creates an archive entity, and never derives a completion
 * percentage or a pass verdict.
 */

const maxItemsPerSource = 200;

export type StageArchiveSource = "lessons" | "records" | "form_records" | "outcomes";
const sources: StageArchiveSource[] = ["lessons", "records", "form_records", "outcomes"];

export interface StageArchiveItem {
  source_id: string;
  title: string;
  occurred_on: string;
  summary?: string;
  reference?: string;
}

export interface StageArchiveData {
  goal_id: string;
  stage_id: string;
  title: string;
  starts_on: string | null;
  ends_on: string | null;
  outcome_criteria: string;
  outcome?: { state: "achieved" | "reopened"; note: string; recorded_at: string };
  evidence_coverage: { source: StageArchiveSource; has_evidence: boolean; item_count: number }[];
  lessons: StageArchiveItem[];
  records: StageArchiveItem[];
  form_records: StageArchiveItem[];
  outcomes: StageArchiveItem[];
  missing_sources: StageArchiveSource[];
  generated_at: string;
}

function dayOf(value: string): string {
  return value.slice(0, 10);
}

function bounded(value: string, length: number): string {
  return value.length > length ? value.slice(0, length) : value;
}

export class GoalStageArchiveService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async get(owner: LightTickOwner, goalId: string, stageId: string): Promise<StageArchiveData> {
    return this.repository.transaction(owner, async () => {
      const goal = await this.repository.getGoal(owner, goalId);
      if (!goal) throw new ApplicationError(404, "LIGHTTICK_NOT_FOUND", "Goal was not found.");
      const stage = readGoalRoadmap(goal).stages.find(item => item.id === stageId);
      if (!stage) throw new ApplicationError(404, "LIGHTTICK_NOT_FOUND", "Stage was not found.");

      // Measured outcomes are goal+stage scoped and readable even without a date window.
      const evidence = await this.repository.stageOutcomeEvidence.list(owner, goalId, { stageId });
      const outcomes: StageArchiveItem[] = evidence
        .filter(item => item.isCurrent)
        .map(item => ({
          source_id: item.id,
          title: bounded(item.metric, 240),
          occurred_on: item.occurredOn,
          summary: bounded(describeValue(item), 2000),
          reference: bounded(
            [item.taskTitle ? `task ${item.taskTitle}` : undefined,
              item.correctedFrom ? `corrects ${item.correctedFrom}` : undefined]
              .filter(Boolean).join("; "),
            240,
          ) || undefined,
        }));

      const windowed = stage.starts_on !== null && stage.ends_on !== null;
      const startsOn = stage.starts_on ?? "", endsOn = stage.ends_on ?? "";
      const lessons: StageArchiveItem[] = [];
      const records: StageArchiveItem[] = [];
      const formRecords: StageArchiveItem[] = [];

      if (windowed) {
        const completed = await this.repository.listCompletedLessons(owner, startsOn, endsOn, maxItemsPerSource);
        for (const entry of completed) {
          const lesson = await this.repository.getNativeLesson(owner, entry.lessonId);
          lessons.push({
            source_id: `${entry.lessonId}@${entry.contentVersion}`,
            title: bounded(lesson?.title ?? entry.lessonId, 240),
            occurred_on: dayOf(entry.completedAt),
            reference: bounded(`lesson ${entry.lessonId} version ${entry.contentVersion}`, 240),
          });
        }

        const rows = await this.repository.listRecords(owner, {
          archived: "all", limit: maxItemsPerSource, startsOn, endsOn,
        });
        for (const row of rows) {
          records.push({
            source_id: row.id,
            title: bounded(row.payload.raw_text.split("\n")[0] || row.id, 240),
            occurred_on: row.payload.record_date,
            summary: bounded(row.payload.raw_text, 2000),
            reference: bounded(`record ${row.id}${row.payload.archived_at ? " (archived)" : ""}`, 240),
          });
        }

        const snapshot = await this.repository.formRecords.get(owner);
        const modules = new Map((snapshot?.data.modules ?? []).map(module => [module.id, module.name]));
        for (const [date, byModule] of Object.entries(snapshot?.data.checkins ?? {})) {
          if (date < startsOn || date > endsOn) continue;
          for (const [moduleId, value] of Object.entries(byModule)) {
            formRecords.push({
              source_id: `${date}:${moduleId}`,
              title: bounded(modules.get(moduleId) ?? moduleId, 240),
              occurred_on: date,
              summary: bounded(String(value), 2000),
              reference: bounded(`form check-in ${date} module ${moduleId}`, 240),
            });
          }
        }
        formRecords.sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || a.source_id.localeCompare(b.source_id));
        formRecords.splice(maxItemsPerSource);
      }

      const groups: Record<StageArchiveSource, StageArchiveItem[]> = {
        lessons, records, form_records: formRecords, outcomes,
      };
      return {
        goal_id: goalId,
        stage_id: stage.id,
        title: stage.title,
        starts_on: stage.starts_on,
        ends_on: stage.ends_on,
        outcome_criteria: stage.outcome_criteria,
        ...(stage.outcome ? { outcome: stage.outcome } : {}),
        evidence_coverage: sources.map(source => ({
          source,
          has_evidence: groups[source].length > 0,
          item_count: groups[source].length,
        })),
        lessons, records, form_records: formRecords, outcomes,
        missing_sources: sources.filter(source => groups[source].length === 0),
        generated_at: this.clock().toISOString(),
      };
    });
  }
}

function describeValue(item: { kind: string; value: Record<string, unknown> }): string {
  const value = item.value as { value?: unknown; unit?: string; comparable_condition?: string };
  if (item.kind === "number") {
    return [String(value.value ?? ""), value.unit ?? "", value.comparable_condition ?? ""]
      .filter(Boolean).join(" ");
  }
  return String(value.value ?? "");
}