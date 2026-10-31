import type { LightTickRepository } from "../lighttick.repository.ts";
import type { PlanningSession } from "./planning.types.ts";
import { planningError, positiveVersion } from "./planning-context.ts";
import { validatePlanOutput } from "../ai/lighttick-ai-validation.ts";
import { taskDetailsFromOutput } from "../lighttick-task-details.ts";
import { assertScheduledCapacity } from "../goal-context/confirmed-conditions.ts";
import { randomId } from "../../../shared/utils.ts";

/** Called under the existing planning owner transaction/lock; editing never materializes work. */
export async function editPlanningDraft(
  repository: LightTickRepository,
  session: PlanningSession,
  input: Record<string, any>,
  now: string,
) {
  if (
    session.status !== "draft_ready" ||
    session.activeRunId ||
    input.draft_plan_id !== session.draftPlanId ||
    positiveVersion(input.context_revision) !== session.contextRevision ||
    session.draftRevision !== session.contextRevision ||
    !session.draftExpiresAt ||
    session.draftExpiresAt <= now
  )
    planningError(
      409,
      "LIGHTTICK_PLANNING_STALE",
      "Review the current, unexpired draft before editing.",
    );
  const plan = await repository.getPlan(session, session.draftPlanId!);
  if (
    !plan ||
    plan.status !== "proposed" ||
    plan.source !== "ai" ||
    plan.goalId !== session.goalId ||
    plan.proposal.planning_session_id !== session.id ||
    plan.version !== positiveVersion(input.plan_version)
  )
    planningError(
      409,
      "LIGHTTICK_PLANNING_STALE",
      "The draft changed; preserve your edits and reload.",
    );
  const goal = await repository.getGoal(session, session.goalId);
  if (!goal || !["draft", "active"].includes(goal.status))
    planningError(
      409,
      "LIGHTTICK_STATE_TRANSITION_INVALID",
      "Stopped goals cannot admit a draft.",
    );
  if (
    !Array.isArray(input.tasks) ||
    input.tasks.some(
      (t: any) =>
        !t ||
        (t.priority !== undefined &&
          (!Number.isInteger(t.priority) ||
            t.priority < -2147483648 ||
            t.priority > 2147483647)) ||
        Object.keys(t).some(
          (k) =>
            ![
              "title",
              "estimated_minutes",
              "scheduled_for",
              "completion_criteria",
              "steps",
              "guidance",
              "priority",
            ].includes(k),
        ),
    )
  )
    planningError(
      422,
      "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
      "Only editable draft task fields are accepted.",
    );
  const timezone = (await repository.getProfile(session))?.timezone ?? "UTC";
  validatePlanOutput(
    { tasks: input.tasks },
    {
      availableMinutes: Number(session.context.available_minutes!.value),
      periodStart: plan.periodStart.slice(0, 10),
      periodEnd: plan.periodEnd.slice(0, 10),
      timezone,
    },
  );
  const tasks = input.tasks.map((t: any) => ({
    title: t.title.trim(),
    estimatedMinutes: t.estimated_minutes,
    scheduledFor: t.scheduled_for,
    priority: t.priority ?? 0,
    ...taskDetailsFromOutput(t),
  }));
  assertScheduledCapacity(
    goal!,
    tasks,
    await repository.listTasks(session),
    new Set(),
    timezone,
  );
  await repository.savePlan(
    { ...plan!, proposal: { ...plan!.proposal, tasks }, updatedAt: now },
    {
      event: {
        appId: session.appId,
        userId: session.userId,
        id: randomId("lighttick_event"),
        aggregateType: "plan",
        aggregateId: plan!.id,
        aggregateVersion: plan!.version + 1,
        eventType: "planning_draft_edited",
        payload: { planning_session_id: session.id },
        occurredAt: now,
        createdAt: now,
      },
      change: {
        appId: session.appId,
        userId: session.userId,
        entityType: "plan",
        entityId: plan!.id,
        entityVersion: plan!.version + 1,
        operation: "upsert",
        snapshot: { status: "proposed" },
        changedAt: now,
      },
    },
    plan!.version,
  );
  return { ...session, lastError: undefined };
}
