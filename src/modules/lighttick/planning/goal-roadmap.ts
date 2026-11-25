import { ApplicationError } from "../../../shared/errors.ts";
import { randomId } from "../../../shared/utils.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickPlanRow } from "../lighttick.types.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";

export const GOAL_ROADMAP_KEY = "goal_stage_roadmap";
const stageIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
export const maxRoadmapStages = 30;
const maxPriorOutcomes = 10;
const maxVisiblePlans = 10;

export interface StageDefinition {
  id: string;
  title: string;
  outcome_criteria: string;
  starts_on: string | null;
  ends_on: string | null;
}

export function roadmapStageDefinition({ id, title, outcome_criteria, starts_on, ends_on }: StageDefinition): StageDefinition {
  return { id, title, outcome_criteria, starts_on, ends_on };
}

interface StageOutcome {
  state: "achieved" | "reopened";
  note: string;
  recorded_at: string;
}

export interface GoalRoadmapStage extends StageDefinition {
  outcome: StageOutcome | null;
  outcome_history?: StageOutcome[];
}

interface StoredRoadmap {
  schema_version: 1;
  version: number;
  stages: GoalRoadmapStage[];
}

type PlanSummary = {
  id: string;
  title: string;
  status: string;
  period_start: string;
  period_end: string;
  source: string;
};

function invalid(message: string): never {
  throw new ApplicationError(400, "REQ_FIELD_INVALID", message);
}

function conflict(message: string): never {
  throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", message);
}

function objectOf(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  return input as Record<string, unknown>;
}

function exactFields(input: Record<string, unknown>, fields: string[]) {
  return Object.keys(input).length === fields.length && fields.every(key => Object.hasOwn(input, key));
}

function boundedText(input: unknown, length: number) {
  if (typeof input !== "string" || input.length > length) return undefined;
  return input.trim() || undefined;
}

function stageDefinition(input: Record<string, unknown>): StageDefinition | undefined {
  const { id, starts_on, ends_on } = input;
  const title = boundedText(input.title, 200);
  const outcome_criteria = boundedText(input.outcome_criteria, 1000);
  if (typeof id !== "string" || !stageIdPattern.test(id) || !title || !outcome_criteria) return undefined;
  if (starts_on === null && ends_on === null) return { id, title, outcome_criteria, starts_on, ends_on };
  if (!dateOnly(starts_on) || !dateOnly(ends_on) || starts_on.startsWith("0000") || starts_on > ends_on) return undefined;
  return { id, title, outcome_criteria, starts_on, ends_on };
}

function validOutcome(input: unknown): input is StageOutcome {
  const value = objectOf(input);
  return !!value && exactFields(value, ["state", "note", "recorded_at"]) && (value.state === "achieved" || value.state === "reopened") &&
    !!boundedText(value.note, 2000) && typeof value.recorded_at === "string" && Number.isFinite(Date.parse(value.recorded_at));
}

function validStage(input: unknown): input is GoalRoadmapStage {
  const value = objectOf(input);
  if (!value || Object.keys(value).some(key => !["id", "title", "outcome_criteria", "starts_on", "ends_on", "outcome", "outcome_history"].includes(key)) ||
      !stageDefinition(value) || (value.outcome !== null && !validOutcome(value.outcome))) return false;
  return value.outcome_history === undefined || (value.outcome !== null && Array.isArray(value.outcome_history) &&
    value.outcome_history.length <= maxPriorOutcomes && value.outcome_history.every(validOutcome));
}

export function readGoalRoadmap(goal: LightTickGoalRow): StoredRoadmap {
  if (goal.constraints[GOAL_ROADMAP_KEY] === undefined) return { schema_version: 1, version: 0, stages: [] };
  const value = objectOf(goal.constraints[GOAL_ROADMAP_KEY]);
  if (!value || value.schema_version !== 1 || !Number.isSafeInteger(value.version) || Number(value.version) < 1 ||
      !Array.isArray(value.stages) || value.stages.length > maxRoadmapStages || !value.stages.every(validStage) ||
      new Set(value.stages.map(stage => stage.id)).size !== value.stages.length)
    conflict("Saved roadmap needs reconciliation before it can be changed.");
  return { schema_version: 1, version: Number(value.version), stages: structuredClone(value.stages) };
}

export function findGoalRoadmapStage(goal: LightTickGoalRow, stageId: string): GoalRoadmapStage | undefined {
  return readGoalRoadmap(goal).stages.find(stage => stage.id === stageId);
}

function normalizeStages(input: unknown, deadline: string | undefined): StageDefinition[] {
  if (!Array.isArray(input) || input.length > maxRoadmapStages) invalid("A roadmap supports at most 30 stages.");
  const seen = new Set<string>();
  const targetDate = deadline?.slice(0, 10);
  return input.map(raw => {
    const object = objectOf(raw);
    const stage = object && exactFields(object, ["id", "title", "outcome_criteria", "starts_on", "ends_on"]) && stageDefinition(object);
    if (!stage || seen.has(stage.id)) invalid("Give each stage a unique ID, a title, an outcome and a valid optional date range.");
    if (dateOnly(targetDate) && stage.ends_on && stage.ends_on > targetDate) invalid("A stage cannot end after the goal deadline.");
    seen.add(stage.id);
    return stage;
  });
}

export function stageIdForPlan(plan: LightTickPlanRow): string | undefined {
  if (typeof plan.proposal.stage_id === "string") return plan.proposal.stage_id;
  const draft = objectOf(plan.proposal.draft);
  return typeof draft?.stage_id === "string" ? draft.stage_id : undefined;
}

function summarizePlan(plan: LightTickPlanRow): PlanSummary {
  const draft = objectOf(plan.proposal.draft);
  const title = boundedText(draft?.title, 200) ?? boundedText(plan.proposal.title, 200);
  const period_start = plan.periodStart.slice(0, 10), period_end = plan.periodEnd.slice(0, 10);
  return { id: plan.id, title: title ?? ("计划 " + period_start), status: plan.status, period_start, period_end, source: plan.source };
}

function project(goal: LightTickGoalRow, roadmap: StoredRoadmap, plans: LightTickPlanRow[]) {
  const byStage = new Map<string, PlanSummary[]>();
  const ordered = plans.filter(plan => ["active", "proposed", "superseded"].includes(plan.status))
    .sort((left, right) => right.periodStart.localeCompare(left.periodStart) ||
      right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  for (const plan of ordered) {
    const stage = stageIdForPlan(plan);
    if (!stage) continue;
    const summaries = byStage.get(stage) ?? [];
    if (summaries.length === maxVisiblePlans) continue;
    summaries.push(summarizePlan(plan));
    byStage.set(stage, summaries);
  }
  return { version: roadmap.version, goal_id: goal.id,
    stages: roadmap.stages.map(stage => {
      const plans = byStage.get(stage.id);
      return plans ? { ...stage, plans } : stage;
    }) };
}

export class GoalRoadmapService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async get(owner: LightTickOwner, goalId: string) {
    return this.repository.transaction(owner, async () => {
      const goal = await this.goal(owner, goalId), roadmap = readGoalRoadmap(goal);
      return project(goal, roadmap, roadmap.stages.length ? await this.repository.listPlans(owner, goalId) : []);
    });
  }

  update(owner: LightTickOwner, goalId: string, input: Record<string, unknown>,
    checkScope?: (previous: GoalRoadmapStage[], definitions: StageDefinition[]) => void) {
    if (!exactFields(input, ["base_version", "stages"])) invalid("Review the roadmap version and stage definitions.");
    return this.mutate(owner, goalId, input.base_version, async (goal, roadmap, plans) => {
      const definitions = normalizeStages(input.stages, goal.targetDate);
      checkScope?.(roadmap.stages, definitions);
      const previous = new Map(roadmap.stages.map(stage => [stage.id, stage]));
      const links = new Set(plans.map(stageIdForPlan));
      const stages: GoalRoadmapStage[] = definitions.map(definition => {
        const current = previous.get(definition.id);
        previous.delete(definition.id);
        if (current?.outcome?.state === "achieved" &&
            (definition.title !== current.title || definition.outcome_criteria !== current.outcome_criteria ||
              definition.starts_on !== current.starts_on || definition.ends_on !== current.ends_on))
          conflict("Reopen an achieved stage before changing its definition.");
        return { ...definition, outcome: current?.outcome ?? null,
          ...(current?.outcome_history ? { outcome_history: current.outcome_history } : {}) };
      });
      if (previous.size) {
        const evidenceStages = new Set(await this.repository.stageOutcomeEvidence.stageIds(owner, goal.id));
        if ([...previous.values()].some(stage => stage.outcome || links.has(stage.id) || evidenceStages.has(stage.id)))
          conflict("A stage with outcome evidence or linked plans cannot be removed.");
      }
      return { stages, type: "goal_roadmap_updated", payload: { stage_ids: stages.map(stage => stage.id) } };
    });
  }

  recordOutcome(owner: LightTickOwner, goalId: string, stageId: string, input: Record<string, unknown>) {
    const { state } = input;
    const note = boundedText(input.note, 2000);
    if (!exactFields(input, ["base_version", "state", "note"]) || !note || (state !== "achieved" && state !== "reopened"))
      invalid("Review the roadmap version, outcome decision and evidence.");
    return this.mutate(owner, goalId, input.base_version, (_goal, roadmap, _plans, recorded_at) => {
      const stage = roadmap.stages.find(item => item.id === stageId);
      if (!stage) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Roadmap stage was not found.");
      if ((state === "reopened") !== (stage.outcome?.state === "achieved"))
        throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Review the current stage outcome.");
      const outcome: StageOutcome = { state, note, recorded_at };
      const history = stage.outcome ? [...(stage.outcome_history ?? []), stage.outcome].slice(-maxPriorOutcomes) : [];
      const stages: GoalRoadmapStage[] = roadmap.stages.map(item => item.id === stageId ? { ...item, outcome,
        ...(history.length ? { outcome_history: history } : {}) } : item);
      return { stages, type: "goal_roadmap_stage_outcome_recorded",
        payload: { stage_id: stage.id, stage_title: stage.title, outcome_criteria: stage.outcome_criteria, ...outcome } };
    });
  }

  private async goal(owner: LightTickOwner, goalId: string) {
    const goal = await this.repository.getGoal(owner, goalId);
    if (!goal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    return goal;
  }

  private mutate(owner: LightTickOwner, goalId: string, expectedVersion: unknown,
    revise: (goal: LightTickGoalRow, roadmap: StoredRoadmap, plans: LightTickPlanRow[], now: string) =>
      { stages: GoalRoadmapStage[]; type: string; payload: Record<string, unknown> } |
      Promise<{ stages: GoalRoadmapStage[]; type: string; payload: Record<string, unknown> }>) {
    if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 0) invalid("Use the latest roadmap version.");
    return this.repository.transaction(owner, async () => {
      await this.repository.lockPlanningOwner(owner);
      const goal = await this.goal(owner, goalId), roadmap = readGoalRoadmap(goal);
      if (!["draft", "active", "recovering"].includes(goal.status))
        throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Paused or ended goal roadmaps are read-only.");
      if (roadmap.version !== expectedVersion) conflict("The roadmap changed. Review its latest version before saving.");
      const plans = await this.repository.listPlans(owner, goalId), timestamp = this.clock().toISOString();
      const revision = await revise(goal, roadmap, plans, timestamp);
      const next: StoredRoadmap = { ...roadmap, version: roadmap.version + 1, stages: revision.stages };
      const constraints = { ...goal.constraints, [GOAL_ROADMAP_KEY]: next };
      const saved = await this.repository.saveGoal({ ...goal, constraints, updatedAt: timestamp }, {
        event: { ...owner, id: randomId("lighttick_event"), aggregateType: "goal", aggregateId: goal.id,
          eventType: revision.type, aggregateVersion: goal.version + 1, payload: { roadmap_version: next.version, ...revision.payload },
          occurredAt: timestamp, createdAt: timestamp },
        change: { ...owner, entityType: "goal", entityId: goal.id, entityVersion: goal.version + 1, operation: "upsert",
          snapshot: { id: goal.id, title: goal.title, status: goal.status, constraints, version: goal.version + 1 }, changedAt: timestamp },
      }, goal.version);
      return project(saved, next, plans);
    });
  }
}
