import assert from "node:assert/strict";
import test from "node:test";
import { courseBrief, courseDocument } from "../../src/modules/lighttick/learning/learning-route.validation.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";
test("formal course conditions preserve weekly and self-paced scheduling, review and prior-only prerequisites", () => {
  const f = routeFixture(), brief = courseBrief(f.brief);
  assert.deepEqual(courseDocument(f.document, brief), f.document);
  assert.deepEqual(courseDocument({ ...f.document, stages: [f.document.stages[0]], lessons: f.document.lessons.map(l => ({ ...l, stage: 1 })) }, courseBrief({ ...f.brief, pacing: "weekly", weeks: 1, sessions: 2 })).lessons.length, 2);
  for (const mutate of [
    (d: any) => { d.lessons.pop(); }, (d: any) => { d.lessons[1].requires = [2]; },
    (d: any) => { d.lessons[0].number = 2; }, (d: any) => { d.lessons[1].kind = "lesson"; },
    (d: any) => { d.lessons[0].minutes = 21; }, (d: any) => { d.lessons[0].stage = 3; },
  ]) { const document = structuredClone(f.document); mutate(document); assert.throws(() => courseDocument(document, brief)); }
  assert.throws(() => courseBrief({ ...f.brief, lesson_count: 365 }));
});
