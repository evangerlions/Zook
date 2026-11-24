import type { LightTickOwner } from "../lighttick.types.ts";
import type { LearningRouteRepository } from "./learning-route.types.ts";
import { ActionService } from "../actions/action.service.ts";
import { normalizeWorkspace } from "../actions/action.facts.ts";
import { sameTarget } from "../actions/action.validation.ts";
import { createPlans } from "../actions/action.commands.ts";
import type { ActionTarget } from "../actions/action.types.ts";

/**
 * Projects a published course route into the action domain: every lesson of the
 * published version becomes one *unscheduled* "content" action targeting
 * `{kind:'plan', plan_id, lesson_no}`. Scheduling stays a user decision, and
 * completion flows back through `LearningActionProjection`.
 *
 * Idempotency is structural: an action is created only when no action for the
 * same target exists yet. The check deliberately ignores `status` and dates, so
 * a retried publish never duplicates a dated action and never resurrects one the
 * owner archived — exactly one action per (route, lesson_no), for good.
 */
const CAPACITY = 1000;
const TITLE_MAX = 160;
const TIMEZONE = "Asia/Shanghai";

export class LearningRouteProjection {
  constructor(
    readonly actions: ActionService,
    readonly routes: LearningRouteRepository,
    readonly clock = () => new Date(),
  ) {}

  async onRoutePublished(
    owner: LightTickOwner,
    routeId: string,
    version: number,
  ): Promise<void> {
    const published = await this.routes.getLearningRouteVersion(
      owner,
      routeId,
      version,
    );
    const lessons = published?.document?.lessons ?? [];
    if (!lessons.length) return;
    const target = (lesson: { number: number }): ActionTarget => ({
      kind: "plan",
      plan_id: routeId,
      lesson_no: lesson.number,
    });
    const now = this.clock();

    await this.actions.repository.transaction(owner, async () => {
      await this.actions.repository.lockActionOwner(owner);
      const row = await this.actions.readWorkspace(owner);
      const w = normalizeWorkspace(structuredClone(row.data));

      const pending = lessons.filter(
        (lesson) =>
          !w.plans.some((plan) => sameTarget(plan.target, target(lesson))),
      );
      // `createPlans` rejects past 1000 plans and would roll back the whole
      // projection, so refuse the entire batch instead of applying a prefix.
      if (w.plans.length + pending.length > CAPACITY) return;

      let changed = false;
      w.content_sources ??= [];
      for (const lesson of lessons) {
        const lessonTarget = target(lesson);
        if (w.content_sources.some((source) => sameTarget(source, lessonTarget)))
          continue;
        w.content_sources.push(lessonTarget);
        changed = true;
      }

      for (const lesson of pending) {
        createPlans(
          w,
          {
            key: "route-publish:" + routeId + ":" + version + ":" + lesson.number,
            title: lesson.topic.slice(0, TITLE_MAX),
            period: "day",
            completion_mode: "content",
            start_date: null,
            end_date: null,
            timezone: TIMEZONE,
            target: target(lesson),
          },
          now,
        );
        changed = true;
      }
      if (!changed) return;

      row.data = w;
      row.version++;
      await this.actions.repository.saveActionWorkspace(row);
    });
  }
}
