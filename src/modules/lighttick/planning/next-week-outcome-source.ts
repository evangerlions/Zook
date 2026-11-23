import { ApplicationError } from "../../../shared/errors.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickGoalRow, LightTickOwner } from "../lighttick.types.ts";
import { findGoalRoadmapStage } from "./goal-roadmap.ts";
import type { StageOutcomeValue } from "./stage-outcome-evidence-store.ts";

export const NEXT_WEEK_EXCERPT_LIMIT = 500;

export interface NextWeekOutcomeSource { evidence_id: string; excerpt?: string; }
type SelectedOutcome =
  | { kind: "text"; excerpt: string }
  | { kind: "number"; value: number; unit: string }
  | { kind: "status"; value: Extract<StageOutcomeValue, { kind: "status" }>["value"]["value"] };

export interface NextWeekStageOutcomeFact {
  id: string;
  kind: "stage_outcome";
  title: string;
  occurred_on: string;
  stage_id: string;
  evidence_id: string;
  outcome: SelectedOutcome;
}

export function parseNextWeekOutcomeSource(value: unknown): NextWeekOutcomeSource | undefined {
  if (value === undefined) return undefined;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const { evidence_id, excerpt, ...unexpected } = value as Record<string, unknown>;
    if (Object.keys(unexpected).length === 0 &&
        typeof evidence_id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(evidence_id) &&
        (excerpt === undefined || (typeof excerpt === "string" && excerpt.trim() && excerpt.length <= NEXT_WEEK_EXCERPT_LIMIT))) {
      return { evidence_id, ...(excerpt === undefined ? {} : { excerpt }) };
    }
  }
  throw new ApplicationError(400, "REQ_FIELD_INVALID", "Choose a stage outcome and an exact excerpt of up to 500 characters for text.");
}

export async function readNextWeekOutcomeSource(repository: LightTickRepository, owner: LightTickOwner,
  goal: LightTickGoalRow, source: NextWeekOutcomeSource, startsOn: string, endsOn: string) {
  const row = (await repository.stageOutcomeEvidence.list(owner, goal.id, { startsOn, endsOn }))
    .find(item => item.id === source.evidence_id);
  if (!row || !findGoalRoadmapStage(goal, row.stageId))
    throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "The stage outcome was not found for this goal and review window.");
  if (!row.isCurrent)
    throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "The selected stage outcome was corrected. Review the current outcome.");
  let outcome: SelectedOutcome;
  if (row.kind === "text") {
    if (source.excerpt === undefined || !row.value.value.includes(source.excerpt))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Choose an exact excerpt from this text outcome.");
    outcome = { kind: row.kind, excerpt: source.excerpt };
  } else {
    if (source.excerpt !== undefined)
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Use the recorded value without an excerpt for this outcome.");
    outcome = row.kind === "number" ? { kind: row.kind, value: row.value.value, unit: row.value.unit }
      : { kind: row.kind, value: row.value.value };
  }
  const fact: NextWeekStageOutcomeFact = { id: "stage_outcome:" + row.id, kind: "stage_outcome", title: row.metric,
    occurred_on: row.occurredOn, stage_id: row.stageId, evidence_id: row.id, outcome };
  return { fact, version: row.version };
}
