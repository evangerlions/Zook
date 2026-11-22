import type { LightTickRepository } from "../../src/modules/lighttick/lighttick.repository.ts";
import type { LightTickGoalRow } from "../../src/modules/lighttick/lighttick.types.ts";
import { GOAL_SUBJECTS_KEY, type GoalSubject } from "../../src/modules/lighttick/planning/goal-subjects.ts";
import { randomId } from "../../src/shared/utils.ts";

export function saveGoalSubjectFixture(repository: LightTickRepository, goal: LightTickGoalRow,
  subjects: readonly GoalSubject[], at: string) {
  const owner = { appId: goal.appId, userId: goal.userId };
  const version = goal.version + 1;
  return repository.saveGoal({
    ...goal, updatedAt: at, constraints: { ...goal.constraints,
      [GOAL_SUBJECTS_KEY]: { schema_version: 1, version, subjects } },
  }, {
    event: { ...owner, id: randomId("lighttick_event"), aggregateType: "goal", aggregateId: goal.id,
      eventType: "test_goal_subjects_updated", aggregateVersion: version, payload: {}, occurredAt: at, createdAt: at },
    change: { ...owner, entityType: "goal", entityId: goal.id, entityVersion: version, operation: "upsert", snapshot: {}, changedAt: at },
  }, goal.version);
}
