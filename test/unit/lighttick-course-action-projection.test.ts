import assert from "node:assert/strict";
import test from "node:test";
import { ActionService } from "../../src/modules/lighttick/actions/action.service.ts";
import { CourseActionProjection } from "../../src/modules/lighttick/learning/course-action-projection.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";

const owner = { appId: "lighttick", userId: "synthetic-course-owner" } as const;
const routeId = "plan-course-action";
const lessonId = "lesson-course-first";
const date = "2026-11-22";
const clock = () => new Date(date + "T08:00:00Z");
const target = { kind: "plan", plan_id: routeId, lesson_no: 1 };

async function setup() {
  const repo = new InMemoryLightTickRepository();
  const native = new NativeLearningService(repo, true, clock, undefined, new CourseActionProjection(repo));
  const routes = new LearningRouteService(native);
  const actions = new ActionService(repo, clock, undefined, true);
  await routes.save(owner, routeId, { base_revision: 0, ...routeFixture() }, "course-save-0001");
  const publish = () => routes.publish(owner, routeId, { base_revision: 1 }, "course-publish-0001");
  await Promise.all([publish(), publish()]);
  return {
    routes, actions, native,
    workspace: async () => (await actions.readWorkspace(owner)).data,
    schedule: (key: string) => actions.request(owner, "POST", "/schedules", { title: "First", date, target, key }),
  };
}

for (const scheduleFirst of [true, false]) {
  test(`native course reuses one action when scheduling ${scheduleFirst ? "before" : "after"} completion`, async () => {
    const { routes, native, workspace, schedule } = await setup();
    const lesson = await routes.publishLesson(owner, routeId, 1, {
      base_revision: 2, lesson_id: lessonId, base_lesson_revision: 0, content: "Published text",
    }, "course-lesson-0001");
    const before = (await workspace()).plans[0];
    const finish = () => native.privateCommand(owner, lessonId, {
      content_version: lesson.content_version, base_revision: 0, action: "complete",
    }, "course-complete-0001");
    if (scheduleFirst) await schedule("course-schedule-0001");
    await Promise.all([finish(), finish()]);
    await Promise.all([schedule("course-schedule-0002"), schedule("course-schedule-0003")]);
    const data = await workspace();
    assert.equal(data.plans.length, 2);
    const matched = data.plans.find(plan => plan.target?.lesson_no === 1)!;
    assert.equal(matched.id, before.id);
    assert.equal(matched.start_date, date);
    assert.equal(matched.status, "completed");
    assert.equal(data.records.length, 1);
    assert.equal(data.content_events?.length, 1);
  });
}

test("republishing keeps archived course actions and rejects a new action for the same source", async () => {
  const { actions, routes, workspace, schedule } = await setup();
  const { id, revision } = (await workspace()).plans[0];
  await actions.request(owner, "POST", `/${id}/operations`, { revision, action: "archive", key: "course-archive-0001" });
  await routes.publish(owner, routeId, { base_revision: 2 }, "course-publish-0002");
  await assert.rejects(schedule("course-archive-schedule"), /archived/);
  assert.equal((await workspace()).plans.length, 2);
  assert.equal((await workspace()).plans[0].status, "archived");
});

test("publishing adopts an existing dated arrangement for the same course lesson", async () => {
  const repo = new InMemoryLightTickRepository();
  const native = new NativeLearningService(repo, true, clock, undefined, new CourseActionProjection(repo));
  const routes = new LearningRouteService(native);
  const actions = new ActionService(repo, clock, undefined, true);
  const row = await actions.readWorkspace(owner);
  await repo.transaction(owner, async () => {
    await repo.saveActionWorkspace({ ...row, version: 1, data: { ...row.data, content_sources: [target] } });
  });
  await actions.request(owner, "POST", "/schedules", { title: "Existing", date, target, key: "existing-course-schedule" });
  const existing = (await actions.readWorkspace(owner)).data.plans[0];
  await routes.save(owner, routeId, { base_revision: 0, ...routeFixture() }, "existing-course-save");
  await routes.publish(owner, routeId, { base_revision: 1 }, "existing-course-publish");
  const plans = (await actions.readWorkspace(owner)).data.plans;
  assert.equal(plans.length, 2);
  assert.equal(plans[0].id, existing.id);
  assert.equal(plans[0].start_date, date);
});
