import { createHash } from "node:crypto";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { LearningRouteRepository } from "./learning-route.types.ts";
import { ActionService } from "../actions/action.service.ts";
import { normalizeWorkspace, reconcileContent } from "../actions/action.facts.ts";
import { sameTarget } from "../actions/action.validation.ts";
import type { ActionContentEvent } from "../actions/action.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";

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
    });
  }
}