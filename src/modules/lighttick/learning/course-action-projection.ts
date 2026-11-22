import type { LightTickOwner } from "../lighttick.types.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import { createPlans, mutatePlan, schedule } from "../actions/action.commands.ts";
import { reconcileNativeCourseAction } from "../actions/action.facts.ts";
import { emptyWorkspace, type ActionPlan, type ActionTarget } from "../actions/action.types.ts";
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

  async arrange(
    owner: LightTickOwner, routeId: string, lesson: number, title: string, date: string,
    timezone: string, minutes: number | null, now: Date, replacementActionId?: string,
  ) {
    await this.repository.lockActionOwner(owner);
    const row = await this.repository.getActionWorkspace(owner) ?? { ...owner, data: emptyWorkspace(), version: 0 };
    const workspace = row.data;
    const target = lessonTarget(routeId, lesson);
    if (!(workspace.content_sources ??= []).some(source => sameTarget(source, target))) workspace.content_sources.push(target);
    if (!(workspace.native_course_targets ??= []).some(source => sameTarget(source, target))) workspace.native_course_targets.push(target);
    const existing = workspace.plans.find(plan => plan.id === replacementActionId && sameTarget(plan.target, target));
    const key = "native-arrangement-" + digest([routeId, lesson, date]).slice(0, 32);
    if (existing?.start_date && existing.start_date !== date) {
      mutatePlan(workspace, existing.id, { key, action: "reschedule", revision: existing.revision, date }, now, owner.userId);
    }
    const { plan } = schedule(workspace, { key, title: title.slice(0, 160).trim(), target, date, timezone, estimated_minutes: minutes }, now, owner.userId) as { plan: ActionPlan };
    await this.repository.saveActionWorkspace({ ...row, version: row.version + 1 });
    return plan.id;
  }

  async move(owner: LightTickOwner, actionId: string, date: string, now: Date) {
    await this.repository.lockActionOwner(owner);
    const row = await this.repository.getActionWorkspace(owner);
    const action = row?.data.plans.find(plan => plan.id === actionId);
    if (!row || !action || action.start_date === date) return;
    mutatePlan(row.data, action.id, { key: "move-native-schedule", action: "reschedule", revision: action.revision, date }, now, owner.userId);
    await this.repository.saveActionWorkspace({ ...row, version: row.version + 1 });
  }

  async release(owner: LightTickOwner, actionId: string, date: string | undefined, now: Date) {
    await this.repository.lockActionOwner(owner);
    const row = await this.repository.getActionWorkspace(owner);
    const action = row?.data.plans.find(plan => plan.id === actionId);
    if (!row || !action || action.start_date !== date || !["active", "paused"].includes(action.status) ||
        row.data.records.some(record => record.plan_id === action.id && record.outcome === "running")) return;
    mutatePlan(row.data, action.id, { key: "release-native-schedule", action: "reschedule", revision: action.revision, date: null }, now, owner.userId);
    await this.repository.saveActionWorkspace({ ...row, version: row.version + 1 });
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
