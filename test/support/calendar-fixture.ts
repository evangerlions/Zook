import { randomUUID } from "node:crypto";
import { seedTodayFocus } from "./today-focus-fixture.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
import { FocusService } from "../../src/modules/lighttick/focus/focus.service.ts";
import { emptyWorkspace } from "../../src/modules/lighttick/actions/action.types.ts";
export async function seedCalendar(app: any, repo: any, pool: any) {
  const o = { appId: "lighttick", userId: "user_alice" };
  const profile = await repo.getProfile(o);
  await repo.saveProfile({
    ...o,
    locale: "zh-CN",
    pace: "balanced",
    onboardingState: "none",
    notificationPreferences: {},
    onboardingDraft: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...profile,
    timezone: "Asia/Shanghai",
    version: (profile?.version ?? 0) + 1,
  });
  const f = await seedTodayFocus(app);
  const t = await repo.getTask(o, f.tasks[0].id);
  await pool.query(
    "UPDATE zook_lighttick_tasks SET scheduled_for=$3,scheduled_business_date=NULL WHERE app_id=$1 AND user_id=$2 AND id=$4",
    [o.appId, o.userId, f.today.business_date + "T02:00:00Z", t.id],
  );
  await app.services.lighttickRuntime.tasks.command(o, t.id, t.version, {
    action: "complete",
    actualMinutes: 3,
    notes: "日历中的明确完成",
  });
  const today = f.today.business_date,
    month = today.slice(0, 7);
  let clock = new Date(month + "-01T00:30:00+08:00");
  const learning = new NativeLearningService(repo, true, () => clock);
  app.services.lighttickRuntime.nativeLearning = learning;
  await learning.saveCollection(
    o,
    "calendar-course",
    {
      base_revision: 0,
      title: "日历参考课程",
      module_id: "english-reading",
      archived: false,
    },
    "calendar-course-create",
  );
  const old = await learning.publish(
    o,
    "lesson-calendar-old",
    {
      base_revision: 0,
      collection_id: "calendar-course",
      number: 1,
      title: "保留旧版本的课",
      content: "# 第一版课文",
      references: "",
    },
    "calendar-old-publish",
  );
  await learning.privateCommand(
    o,
    old.id,
    {
      action: "complete",
      content_version: old.content_version,
      base_revision: 0,
    },
    "calendar-old-complete",
  );
  await learning.publish(
    o,
    old.id,
    {
      base_revision: 1,
      collection_id: "calendar-course",
      number: 1,
      title: "保留旧版本的课",
      content: "# 第二版课文",
      references: "",
    },
    "calendar-new-publish",
  );
  const legacy = await repo.getNativeLesson(o, old.id);
  // Preserve the real older completion; source-only completion has an unknown date.
  await repo.saveNativeLesson(
    {
      ...legacy,
      sourceCompleted: true,
      sourceCompletedVersion: legacy.publishedVersion,
    },
    legacy.revision,
  );
  const reading = new ReadingService(repo, () => clock),
    created = await reading.create(o, {
      url: "https://example.test/calendar",
      title: "日历参考文章",
      language: "zh",
      topic: "认知",
      body_kind: "none",
      summary: "仅有摘要",
    }),
    article = created.article;
  await reading.saveState(o, article.id, {
    base_version: 0,
    position_ratio: 100,
    completed: true,
  });
  await repo.saveReadingEntry(o, "task", {
    id: randomUUID(),
    article_id: article.id,
    title: article.title,
    revision: 1,
    business_date: today,
    status: "completed",
    updated_at: clock.toISOString(),
  });
  for (let index = 0; index < 23; index++)
    await f.ok(
      "PUT",
      "records/calendar-record-" + String(index).padStart(2, "0"),
      {
        base_version: 0,
        raw_text: "日历随手记 " + index,
        record_date: today,
        prompt_kind: "free",
        guided_answers: {},
        tags: [],
      },
    );
  const w = emptyWorkspace(),
    aid = "action-" + randomUUID();
  w.plans.push({
    id: aid,
    revision: 1,
    title: "日历共享行动",
    period: "day",
    horizon: "short",
    start_date: today,
    end_date: today,
    timezone: "Asia/Shanghai",
    parent_id: null,
    target_minutes: 10,
    minimum_minutes: 2,
    target_count: 1,
    at: null,
    reminder: false,
    reason: "",
    if_then: "",
    target: null,
    completion_mode: "time",
    estimated_minutes: 10,
    status: "active",
    created_at: clock.toISOString(),
    updated_at: clock.toISOString(),
    reminder_at: null,
    schema_version: 2,
    completed_at: null,
    completion_record_id: null,
  });
  w.records.push({
    id: "calendar-session",
    plan_id: aid,
    title: "日历共享行动",
    started_at: clock.toISOString(),
    ended_at: clock.toISOString(),
    variant: "standard",
    planned_minutes: 10,
    actual_minutes: 3,
    outcome: "partial",
    note: "有投入，未确认完成",
    business_date: month + "-01",
    timezone: "Asia/Shanghai",
    target: null,
    schema_version: 2,
    record_kind: "session",
    completion_mode: "time",
    completion_effect: "none",
    planned_date: today,
    date_basis: "actual_start",
  });
  await repo.saveActionWorkspace({ ...o, version: 1, data: w });
  const focus = new FocusService(repo, () => clock),
    focused = await focus.start(o, {
      request_key: "calendar-focus-start",
      kind: "focus",
      title: "日历专注原记录",
      planned_seconds: 60,
    });
  clock = new Date(clock.getTime() + 60000);
  await focus.command(o, focused.session!.id, {
    request_key: "calendar-focus-save",
    base_version: 1,
    action: "finish",
    actual_seconds: 45,
    notes: "专注与课程时长独立",
  });
  const rest = await focus.start(o, {
    request_key: "calendar-rest-start",
    kind: "break",
    title: "日历休息原记录",
    planned_seconds: 60,
  });
  clock = new Date(clock.getTime() + 60000);
  await focus.command(o, rest.session!.id, {
    request_key: "calendar-rest-save",
    base_version: 1,
    action: "finish",
    actual_seconds: 30,
    notes: "休息单独计",
  });
  return {
    ...f,
    month,
    article_id: article.id,
    lesson_id: old.id,
    old_version: old.content_version,
    focus_id: focused.session!.id,
  };
}
