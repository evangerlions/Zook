import { createHash } from "node:crypto";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { LearningRouteRepository } from "./learning-route.types.ts";
import { ActionService } from "../actions/action.service.ts";
import { normalizeWorkspace, reconcileContent } from "../actions/action.facts.ts";
import { sameTarget } from "../actions/action.validation.ts";
import type { ActionContentEvent } from "../actions/action.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { randomId } from "../../../shared/utils.ts";

/**
 * Bridges the learning domain into the action domain: when a native lesson that
 * belongs to a formal course route is explicitly completed, emit a content
 * confirmation event so a matching "content" action scheduled for that day is
 * reconciled automatically. The event is stored even when no action is scheduled
 * yet, so a later scheduling can reconcile it (mirroring the external source
 * receipt model). The whole projection is idempotent (deterministic event id).
 */
const BENIGN_RECONCILE_CODES = new Set([
  "RUNNING_CONFLICT",
  "STATE_CONFLICT",
  "FUTURE_ACTION",
  "UNSCHEDULED_ACTION",
  "COMPLETION_EVIDENCE_MISSING",
]);

export class LearningActionProjection {
  constructor(
    readonly actions: ActionService,
    readonly routes: LearningRouteRepository,
    readonly clock = () => new Date(),
  ) {}

  async onLessonCompleted(
    owner: LightTickOwner,
    lessonId: string,
    contentVersion: string,
  ): Promise<void> {
    const link = await this.routes.getRouteLessonLinkByLessonId(owner, lessonId);
    if (!link) return;
    const target = {
      kind: "plan",
      plan_id: link.routeId,
      lesson_no: link.number,
    };
    const eventId =
      "native-" +
      createHash("sha256")
        .update(`${owner.userId}:${lessonId}:${contentVersion}`)
        .digest("hex")
        .slice(0, 32);
    const now = this.clock();

    await this.actions.repository.transaction(owner, async () => {
      await this.actions.repository.lockActionOwner(owner);
      const row = await this.actions.readWorkspace(owner);
      const w = normalizeWorkspace(structuredClone(row.data));
      if (w.content_events?.some((e) => e.event_id === eventId)) return;

      w.content_sources ??= [];
      if (!w.content_sources.some((t) => sameTarget(t, target)))
        w.content_sources.push(target);

      const event: ActionContentEvent = {
        event_id: eventId,
        owner_id: owner.userId,
        normalized_target: target,
        confirmed_at: now.toISOString(),
        origin_action_id: null,
      };
      (w.content_events ??= []).push(event);

      for (const plan of w.plans) {
        if (
          plan.schema_version !== 2 ||
          plan.period !== "day" ||
          plan.completion_mode !== "content" ||
          plan.status !== "active" ||
          !sameTarget(plan.target, target)
        )
          continue;
        try {
          reconcileContent(w, plan, now, owner.userId, eventId);
          plan.revision++;
          plan.updated_at = now.toISOString();
          break;
        } catch (error) {
          if (
            !(error instanceof ApplicationError) ||
            !BENIGN_RECONCILE_CODES.has(error.code)
          )
            throw error;
        }
      }

      row.data = w;
      row.version++;
      await this.actions.repository.saveActionWorkspace(row);

      // S0 5.2 / M8: an explicitly learned lesson completes the matching A-domain
      // learn-purpose task scheduled for this business day. review/apply tasks and
      // other days keep their own completion criteria; terminal tasks are skipped,
      // which also makes combined completion idempotent (the task is completed first).
      const repo = this.actions.repository;
      const timezone = (await repo.getProfile(owner))?.timezone ?? "UTC";
      const businessDate = businessDateAt(now, timezone);
      for (const task of await repo.listTasks(owner)) {
        const lt = task.learningTarget;
        if (!lt || lt.purpose !== "learn" || lt.plan_id !== link.routeId || lt.lesson_no !== link.number) continue;
        if (!["pending", "in_progress"].includes(task.status)) continue;
        const date = task.scheduledFor
          ? (/^\d{4}-\d{2}-\d{2}$/.test(task.scheduledFor) ? task.scheduledFor : businessDateAt(new Date(task.scheduledFor), timezone))
          : null;
        if (date !== businessDate) continue;
        const goal = await repo.getGoal(owner, task.goalId);
        if (goal && (["completed", "archived", "paused"].includes(goal.status) ||
          (goal.status === "recovering" && (task.selectedVariant ?? "standard") === "standard"))) continue;
        const stamp = now.toISOString();
        await repo.saveTask({ ...task, status: "completed", completedAt: stamp, commitmentSatisfied: true, updatedAt: stamp }, {
          event: { ...owner, id: randomId("lighttick_event"), aggregateType: "task", aggregateId: task.id,
            eventType: "task_completed", aggregateVersion: task.version + 1,
            payload: { source: "lesson_completion", lesson_id: lessonId, content_version: contentVersion, event_id: eventId,
              valid_action: true, commitment_satisfied: true, title: task.title, lineage_id: task.lineageId ?? task.id,
              scheduled_for: task.scheduledFor ?? null },
            occurredAt: stamp, createdAt: stamp },
          change: { ...owner, entityType: "task", entityId: task.id, entityVersion: task.version + 1,
            operation: "upsert", snapshot: { id: task.id, status: "completed", version: task.version + 1 }, changedAt: stamp },
        }, task.version);
      }
    });
  }
}