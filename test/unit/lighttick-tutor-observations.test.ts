import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { STRUCTURED_THINKING, tutorMaterial } from "../../src/modules/lighttick/learning/tutor-material.ts";
import { TutorObservations } from "../../src/modules/lighttick/learning/tutor-observations.ts";
import { TutorWork } from "../../src/modules/lighttick/learning/tutor-work.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";

const owner = { appId: "lighttick" as const, userId: "observation-owner" };
const other = { ...owner, userId: "observation-other" };
const routeId = "plan-observation";
const lessonId = "lesson-observation";
const { question, concept } = tutorMaterial(STRUCTURED_THINKING);
const answer = "9 条已验证，还有 3 条需要补数据。";
const content = "## 概念\n先核对资料。\n## 参考分析\n按已核对的事项说明结果。\n## 自查\n逐条检查。";
const authorize = async () => {};

async function fixture() {
  let instant = new Date("2026-11-23T07:00:00Z");
  const clock = () => instant;
  const repository = new InMemoryLightTickRepository();
  const native = new NativeLearningService(repository, true, clock);
  const routes = new LearningRouteService(native);
  const work = new LearningWorkService(routes, new InMemoryJobQueue(), () => true);
  const tutor = new TutorWork(work);
  const observations = new TutorObservations(work);
  const runner = new LearningWorkRunner(work, { complete: async () => ({
    provider: "test", providerModel: "test", modelKey: "test",
    text: JSON.stringify({ message: "ORIGINAL_REPLY_PRIVATE", next_step: "再给出下一步建议。", verdict: "supported", answer_quote: "9 条已验证" }),
  }) }, { readFile: async () => { throw Error("Unexpected file"); }, fetchUrl: async () => { throw Error("Unexpected URL"); } });

  let contentVersion = "";
  for (const actor of [owner, other]) {
    await routes.save(actor, routeId, { base_revision: 0, ...routeFixture() }, "observation-route-draft");
    await routes.publish(actor, routeId, { base_revision: 1 }, "observation-route-publish");
    const published = await routes.publishLesson(actor, routeId, 1, { base_revision: 2, base_lesson_revision: 0,
      lesson_id: lessonId, content, references: "作者自编" }, "observation-lesson-publish", authorize, STRUCTURED_THINKING);
    contentVersion = published.content_version;
  }
  const prepare = { content_version: contentVersion, concept_id: concept.id, question_id: question.id };
  const save = async (value: string, base: number) => await native.privateCommand(owner, lessonId, {
    content_version: contentVersion, action: "save", base_revision: base, notes: "ORIGINAL_NOTES_PRIVATE",
    answers: [{ id: question.id, prompt: question.prompt, answer: value }],
  }, "observation-answer-" + base);
  const state = await save(answer, 0);
  await tutor.submit(owner, lessonId, { ...prepare, action: "reference" }, "observation-reference", authorize);
  const feedback = await tutor.submit(owner, lessonId, { ...prepare, action: "feedback", consent: true, answer_revision: state.notes_revision },
    "observation-practice-feedback", authorize);
  await runner.execute(owner, feedback.id);
  assert.equal((await work.read(owner, feedback.id)).status, "succeeded");
  const allowRequest = { content_version: contentVersion, action: "allow", base_revision: 0, turn_id: feedback.id };
  const allow = () => observations.command(owner, lessonId, allowRequest, "observation-allow-once", authorize);
  const read = () => observations.read(owner, lessonId, contentVersion);
  const snapshot = () => observations.snapshot(owner, lessonId, contentVersion);
  return { clock, repository, native, contentVersion, routes, work, tutor, observations, prepare, state, feedback, save, allow, read, snapshot,
    elapse: (days: number) => { instant = new Date(instant.valueOf() + days * 86_400_000); } };
}

test("one feedback never grants future use; approve, correct and stop use independent revisions", async () => {
  const f = await fixture();
  assert.deepEqual(await f.read(), { revision: 0, completed: false, status: "off", available_turns: [f.feedback.id], observation: null });
  assert.equal(await f.snapshot(), undefined);
  assert.deepEqual(await f.allow(), { revision: 1 });
  const active = await f.read();
  assert.equal(active.status, "active");
  assert.equal(active.completed, false);
  assert.deepEqual(active.observation?.assistance, ["reference"]);
  assert.equal(active.observation?.goal_id, null);
  assert.equal(active.observation?.route_id, routeId);
  const approved = await f.snapshot();
  assert.deepEqual(approved, { revision: 1, goalId: null, summary: {
    concept: concept.title, assisted: true, practice_feedback: "supported",
  } });
  assert.doesNotMatch(JSON.stringify({ active, approved }), /ORIGINAL_|9 条已验证/);

  const correct = { content_version: f.contentVersion, action: "correct", base_revision: 1,
    correction: "我还需要练习给出两条可核对的依据。" };
  const attempts = await Promise.allSettled(["observation-correct-first", "observation-correct-other"].map(key =>
    f.observations.command(owner, lessonId, correct, key, authorize)));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await f.snapshot())?.summary.learner_correction, correct.correction);
  const stop = { content_version: f.contentVersion, action: "stop", base_revision: 2 };
  assert.deepEqual(await f.observations.command(owner, lessonId, stop, "observation-stop-once", authorize), { revision: 3 });
  assert.deepEqual(await f.allow(), { revision: 1 }, "same key returns the historical receipt without repeating the permission change");
  assert.equal((await f.read()).revision, 3);
  assert.equal((await f.read()).status, "off");
  assert.equal(await f.snapshot(), undefined);
});

test("course refinements use explicit observation scope and recheck it through publication", async () => {
  for (const withdrawal of ["result", "adoption", "publication"] as const) {
    const f = await fixture();
    await f.allow();
    const source = { lesson_id: lessonId, content_version: f.contentVersion, observation_revision: 1, goal_id: null };
    const body = { kind: "route_refine", route_id: routeId, base_revision: 3, observation_source: source };
    await assert.rejects(f.work.create(owner, { ...body, observation_source: { ...source, goal_id: "unrelated-goal" } },
      "observation-refinement-wrong-goal"), { statusCode: 409 });
    const created = await f.work.create(owner, body, "observation-refinement-create");
    const stop = () => f.observations.command(owner, lessonId, { content_version: f.contentVersion, action: "stop", base_revision: 1 },
      "observation-refinement-stop", authorize);
    const runner = new LearningWorkRunner(f.work, { complete: async input => {
      const prompt = String(input.messages.at(-1)?.content);
      const modelInput = JSON.parse(prompt.split("\nINPUT_JSON=").at(-1)!);
      assert.deepEqual(modelInput.learning_observation, { concept: concept.title, assisted: true, practice_feedback: "supported" });
      assert.doesNotMatch(prompt, /ORIGINAL_|observation-owner|lesson-observation|9 条已验证/);
      if (withdrawal === "result") await stop();
      const document = routeFixture().document;
      document.lessons[1]!.topic = "练习给出可核对的依据";
      return { provider: "test", providerModel: "test", modelKey: "test", text: JSON.stringify(document) };
    } }, { readFile: async () => { throw Error("Unexpected file"); }, fetchUrl: async () => { throw Error("Unexpected URL"); } });
    await runner.execute(owner, created.id);
    const completed = await f.work.read(owner, created.id);
    if (withdrawal === "result") {
      assert.equal(completed.error_code, "LEARNING_CONTEXT_STALE");
      assert.equal(completed.output, null);
      continue;
    }
    assert.equal(completed.status, "succeeded");
    const adopt = () => f.work.adopt(owner, completed.id, { base_revision: completed.revision, base_route_revision: 3,
      expected_digest: completed.output_digest }, "observation-refinement-adopt", authorize);
    if (withdrawal === "adoption") {
      await stop();
      assert.equal((await f.work.read(owner, created.id)).output, null);
      await assert.rejects(adopt(), { statusCode: 409 });
      continue;
    }
    const adopted = await adopt();
    await stop();
    await assert.rejects(f.routes.publish(owner, routeId, { base_revision: adopted.result.revision },
      "observation-refinement-publish", authorize), { statusCode: 409 });
    const edited = routeFixture();
    edited.document.lessons[1]!.topic = "本人修改过的同一草案";
    await f.routes.save(owner, routeId, { base_revision: adopted.result.revision, ...edited }, "observation-refinement-edit", authorize);
    await assert.rejects(f.routes.publish(owner, routeId, { base_revision: adopted.result.revision + 1 },
      "observation-refinement-republish", authorize), { statusCode: 409 });
    assert.equal((await f.repository.learningRoutes.getLearningRoute(owner, routeId))?.publishedVersion, 1);
    assert.deepEqual((await f.routes.read(owner, routeId, 1)).document, routeFixture().document);
    const reset = await f.routes.save(owner, routeId, { base_revision: adopted.result.revision + 1, ...routeFixture() },
      "observation-refinement-reset", authorize);
    assert.equal((await f.repository.learningRoutes.getLearningRoute(owner, routeId))?.refinement, undefined);
    assert.equal(reset.published_version, 1);
  }
});

test("challenge or changed answer invalidates exactly the originating observation", async () => {
  const challenge = await fixture();
  await challenge.allow();
  await challenge.tutor.submit(owner, lessonId, {
    ...challenge.prepare, action: "feedback", parent_id: challenge.feedback.id, message: "请重看事实范围。",
    consent: true, answer_revision: challenge.state.notes_revision,
  }, "observation-source-dispute", authorize);
  assert.equal((await challenge.read()).invalid_reason, "source_changed");
  assert.equal(await challenge.snapshot(), undefined);
  assert.equal((await challenge.read()).completed, false);

  const revised = await fixture();
  await revised.allow();
  await revised.save("已经做了其他核对。", revised.state.notes_revision);
  assert.equal((await revised.read()).invalid_reason, "source_changed");
  assert.deepEqual((await revised.read()).available_turns, []);
});

test("scope change, expiry and authorization renewal cannot resurrect stale grants", async () => {
  const f = await fixture();
  await f.allow();
  const foreign = await f.observations.read(other, lessonId, f.contentVersion);
  assert.equal(foreign.status, "off");
  assert.deepEqual(foreign.available_turns, []);
  await assert.rejects(f.observations.command(other, lessonId, {
    content_version: f.contentVersion, action: "allow", base_revision: 0, turn_id: f.feedback.id,
  }, "observation-foreign-source", authorize), { statusCode: 409 });

  const goals = new LightTickGoalService(f.repository, f.clock);
  const goal = await goals.create(owner, { title: "Organize a report", constraints: {} });
  const plans = new LightTickPlanService(f.repository, f.clock);
  const activation = await plans.createProposed(owner, { goalId: goal.id, source: "template", granularity: "week",
    periodStart: "2026-11-23", periodEnd: "2026-11-29", tasks: [{ title: "Choose a project topic", estimatedMinutes: 10 }] });
  await plans.confirm(owner, activation.id, activation.version);
  const attachSchedule = async (title: string) => {
    const plan = await plans.createProposed(owner, { goalId: goal.id, source: "learning_schedule", granularity: "week",
      periodStart: "2026-11-23", periodEnd: "2026-11-29", tasks: [{ title, estimatedMinutes: 10 }],
      metadata: { learning_route_id: routeId } });
    await f.repository.savePlan({ ...plan, status: "active" }, {
      event: { ...owner, id: "scope-test-event-" + plan.id, aggregateType: "plan", aggregateId: plan.id,
        eventType: "plan_confirmed", aggregateVersion: plan.version + 1, payload: {},
        occurredAt: f.clock().toISOString(), createdAt: f.clock().toISOString() },
      change: { ...owner, entityType: "plan", entityId: plan.id, entityVersion: plan.version + 1, operation: "upsert",
        changedAt: f.clock().toISOString() },
    }, plan.version);
  };
  await attachSchedule("Practice one briefing");
  assert.equal((await f.read()).invalid_reason, "scope_changed");
  assert.equal(await f.snapshot(), undefined);
  await f.observations.command(owner, lessonId, { content_version: f.contentVersion, action: "allow",
    base_revision: 1, turn_id: f.feedback.id }, "observation-allow-attached", authorize);
  const activeGoal = await goals.get(owner, goal.id);
  const edited = await goals.update(owner, goal.id, activeGoal.version, { description: "Rephrase the goal description." });
  await attachSchedule("Review one briefing");
  assert.equal((await f.snapshot())?.goalId, goal.id, "same-course schedule and ordinary goal edits keep the existing grant");
  await goals.transition(owner, goal.id, edited.version, "pause");
  assert.equal((await f.read()).invalid_reason, "scope_changed");

  const expired = await fixture();
  await expired.allow();
  expired.elapse(30);
  assert.equal((await expired.read()).invalid_reason, "expired");
  assert.equal(await expired.snapshot(), undefined);

  const renewed = await fixture();
  await renewed.allow();
  for (const privateEnabled of [false, true]) {
    const authority = (await renewed.native.authority(owner))!;
    await renewed.native.consent(owner, { base_revision: authority.revision, private_enabled: privateEnabled, reading_enabled: true },
      "observation-renew-" + privateEnabled);
    await assert.rejects(renewed.allow(), { statusCode: 403 });
  }
  assert.equal((await renewed.read()).invalid_reason, "authorization_changed");
  assert.equal(await renewed.snapshot(), undefined);
  await renewed.repository.deleteOwnerData(owner);
  assert.equal(await renewed.repository.learningRoutes.work.tutorObservation(owner, lessonId), undefined);
  assert.equal((await renewed.observations.read(other, lessonId, renewed.contentVersion)).status, "off");
});
