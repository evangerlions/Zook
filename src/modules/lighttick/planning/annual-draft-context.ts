import { ApplicationError } from "../../../shared/errors.ts";
import { sha256 } from "../../../shared/utils.ts";
import type { LightTickPublicConfiguration } from "../lighttick-public-config.ts";
import { todayDateAt } from "../lighttick-today.service.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";
import { calendarYear, editableAnnualGoalStatuses } from "./annual-planning.ts";
import { maxRoadmapStages, readGoalRoadmap, roadmapStageDefinition, stageIdForPlan } from "./goal-roadmap.ts";
import { readWeeklyPlanableMinutes } from "./weekly-capacity.ts";

export const annualDraftScene = "annual_plan_draft";
export const annualDraftMaxGoals = 8;
export const annualDraftFocusLimit = 500;
const maxVisibleStagesPerGoal = 4;
const goalIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;

interface AnnualDraftRequest {
  year: number;
  goal_ids: string[];
  focus?: string;
}

export function readAnnualDraftRequest(body: Record<string, unknown>): AnnualDraftRequest {
  const { year } = calendarYear(body.year);
  const { goal_ids, focus } = body;
  if (Object.keys(body).some(key => !["year", "goal_ids", "focus"].includes(key)) ||
      !Array.isArray(goal_ids) || goal_ids.length < 1 || goal_ids.length > annualDraftMaxGoals ||
      !goal_ids.every(id => typeof id === "string" && goalIdPattern.test(id)) || new Set(goal_ids).size !== goal_ids.length ||
      (focus !== undefined && (typeof focus !== "string" || focus.length > annualDraftFocusLimit)))
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Choose one to eight unique goals in priority order and an optional focus of up to 500 characters.");
  return { year, goal_ids, ...(typeof focus === "string" && focus.trim() ? { focus: focus.trim() } : {}) };
}

function deadlineError(): never {
  throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Choose a year and goals with time left before their existing deadlines.");
}

export function annualDraftFlagsEnabled(features: LightTickPublicConfiguration["features"]) {
  return features.conversational_planning && features.ai_coach;
}

export function assertAnnualDraftAvailable(available: boolean): void {
  if (!available) throw new ApplicationError(503, "LIGHTTICK_AI_UNAVAILABLE", "Annual AI suggestions are unavailable. Manual annual planning remains available.");
}

export async function loadAnnualDraftContext(repository: LightTickRepository, owner: LightTickOwner, request: AnnualDraftRequest, now: Date) {
  const year = calendarYear(request.year);
  const profile = await repository.getProfile(owner);
  const { timezone, businessDate: business_date } = todayDateAt(now, profile?.timezone ?? "UTC");
  const starts_on = business_date > year.starts_on ? business_date : year.starts_on;
  if (starts_on > year.ends_on) deadlineError();
  const goals = [];
  const roadmaps = new Map<string, ReturnType<typeof readGoalRoadmap>>();
  for (const goal_id of request.goal_ids) {
    const goal = await repository.getGoal(owner, goal_id);
    if (!goal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    if (!editableAnnualGoalStatuses.has(goal.status))
      throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Choose a goal whose roadmap is editable.");
    const target = goal.targetDate?.slice(0, 10);
    const deadline = dateOnly(target) ? target : null;
    if (deadline && deadline < starts_on) deadlineError();
    const roadmap = readGoalRoadmap(goal);
    roadmaps.set(goal_id, roadmap);
    const linked = new Set((await repository.listPlans(owner, goal_id)).map(stageIdForPlan));
    const upcoming = roadmap.stages.filter(stage => stage.starts_on === null ||
      (stage.starts_on <= year.ends_on && stage.ends_on! >= starts_on));
    const stages = upcoming.slice(0, maxVisibleStagesPerGoal).map(stage => {
      const definition = roadmapStageDefinition(stage);
      return {
        ...definition,
        title: definition.title.slice(0, 70),
        outcome_criteria: definition.outcome_criteria.slice(0, 90),
        may_edit: !stage.outcome && !stage.outcome_history?.length && !linked.has(stage.id) &&
          (stage.starts_on === null || (stage.starts_on >= starts_on && stage.ends_on! <= year.ends_on)),
      };
    });
    goals.push({
      goal_id, title: goal.title.slice(0, 120), status: goal.status, deadline, roadmap_version: roadmap.version,
      remaining_stage_slots: maxRoadmapStages - roadmap.stages.length, has_more_stages: upcoming.length > stages.length, stages,
    });
  }
  const weekly_budget_minutes = await readWeeklyPlanableMinutes(repository, owner);
  const input = { ...year, starts_on, business_date, timezone, goals, weekly_budget_minutes,
    ...(request.focus ? { focus: request.focus } : {}) };
  return { input, roadmaps, fingerprint: sha256(JSON.stringify(input)) };
}

export type AnnualDraftInput = Awaited<ReturnType<typeof loadAnnualDraftContext>>["input"];

export interface AnnualDraftSnapshot {
  request: AnnualDraftRequest;
  fingerprint: string;
}

export async function requireCurrentAnnualDraftContext(repository: LightTickRepository, owner: LightTickOwner,
  snapshot: AnnualDraftSnapshot, now: Date) {
  try {
    const current = await loadAnnualDraftContext(repository, owner, snapshot.request, now);
    if (snapshot.fingerprint === current.fingerprint) return current;
  } catch (error) {
    if (!(error instanceof ApplicationError) || error.statusCode >= 500) throw error;
  }
  throw new ApplicationError(409, "LIGHTTICK_PLANNING_STALE", "The year, selected goals, or budget changed. Review current information before asking again.");
}
