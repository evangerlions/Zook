import { ApplicationError } from "../../../shared/errors.ts";
import type { LightTickGoalRow } from "../lighttick.types.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";
import { findGoalRoadmapStage } from "./goal-roadmap.ts";

export function assertRoadmapPlacement(goal: LightTickGoalRow, stageId: string, startsOn?: string, endsOn?: string) {
  const stage = findGoalRoadmapStage(goal, stageId);
  if (!stage || stage.outcome?.state === "achieved") {
    throw new ApplicationError(409, "LIGHTTICK_ROADMAP_STAGE_UNAVAILABLE", "Review the selected stage before arranging this plan.");
  }
  const deadline = goal.targetDate?.slice(0, 10);
  if ((startsOn && stage.starts_on && startsOn < stage.starts_on) ||
    (endsOn && (stage.ends_on && endsOn > stage.ends_on || dateOnly(deadline) && endsOn > deadline))) {
    throw new ApplicationError(422, "LIGHTTICK_ROADMAP_STAGE_WINDOW", "The plan dates must fit the selected stage and goal deadline.");
  }
  return stage;
}
