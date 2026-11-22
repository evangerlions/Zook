import type { LightTickOwner } from "../lighttick.types.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import { createPlans } from "../actions/action.commands.ts";
import { reconcileNativeCourseAction } from "../actions/action.facts.ts";
import { emptyWorkspace, type ActionTarget } from "../actions/action.types.ts";
import { digest, sameTarget } from "../actions/action.validation.ts";
import type { CourseDocument } from "./learning-route.types.ts";

const lessonTarget = (routeId: string, number: number): ActionTarget => ({ kind: "plan", plan_id: routeId, lesson_no: number });

export class CourseActionProjection {
  constructor(private readonly repository: LightTickRepository) {}

  async publish(owner: LightTickOwner, routeId: string, lessons: CourseDocument["lessons"], now: Date) {
    await this.repository.lockActionOwner(owner);
    const row = await this.repository.getActionWorkspace(owner) ?? { ...owner, data: emptyWorkspace(), version: 0 };
    const workspace = row.data;
    const targets = lessons.map(lesson => lessonTarget(routeId, lesson.number));
    const pending = lessons.filter((_, index) => !workspace.plans.some(plan => plan.period === "day" && plan.completion_mode === "content" && sameTarget(plan.target, targets[index])));
    if (workspace.plans.length + pending.length > 1000) return;
    const timezone = (await this.repository.getProfile(owner))?.timezone ?? "Asia/Shanghai";

    let changed = false;
    for (const target of targets) {
      workspace.content_sources ??= [];
      if (!workspace.content_sources.some(source => sameTarget(source, target))) {
        workspace.content_sources.push(target);
        changed = true;
      }
      workspace.native_course_targets ??= [];
      if (!workspace.native_course_targets.some(source => sameTarget(source, target))) {
        workspace.native_course_targets.push(target);
        changed = true;
      }
    }
    for (const lesson of pending) {
      createPlans(workspace, {
        key: "native-course-" + digest([routeId, lesson.number]).slice(0, 32),
        title: lesson.topic.slice(0, 160).trim(),
        period: "day", completion_mode: "content", start_date: null, end_date: null,
        timezone, target: lessonTarget(routeId, lesson.number),
      }, now);
      changed = true;
    }
    if (changed) await this.repository.saveActionWorkspace({ ...row, version: row.version + 1 });
  }

  async complete(owner: LightTickOwner, routeId: string, lessonId: string, version: string, now: Date) {
    const link = (await this.repository.learningRoutes.listRouteLessonLinks(owner, routeId)).find(item => item.lessonId === lessonId);
    if (!link) return;

    await this.repository.lockActionOwner(owner);
    const row = await this.repository.getActionWorkspace(owner);
    if (!row) return;
    const target = lessonTarget(routeId, link.number);
    if (!row.data.native_course_targets?.some(source => sameTarget(source, target))) return;
    const eventId = "native-course-" + digest([owner.appId, owner.userId, lessonId, version]).slice(0, 32);
    const events = row.data.content_events ??= [];
    if (events.some(event => event.event_id === eventId)) return;

    events.push({ event_id: eventId, owner_id: owner.userId, normalized_target: target, confirmed_at: now.toISOString() });
    for (const plan of row.data.plans) {
      if (sameTarget(plan.target, target) && reconcileNativeCourseAction(row.data, plan, now, owner.userId)) {
        plan.revision++;
        plan.updated_at = now.toISOString();
        break;
      }
    }
    await this.repository.saveActionWorkspace({ ...row, version: row.version + 1 });
  }
}
