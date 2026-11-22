import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { routeProgress } from "../../src/modules/lighttick/learning/learning-route.progress.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { STRUCTURED_THINKING, STRUCTURED_THINKING_FOLLOWUP, tutorMaterial } from "../../src/modules/lighttick/learning/tutor-material.ts";
import { TutorWork } from "../../src/modules/lighttick/learning/tutor-work.ts";
import { TutorObservations } from "../../src/modules/lighttick/learning/tutor-observations.ts";
import type { LLMCompletionRequest } from "../../src/services/llm-manager-types.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";

const owner = { appId: "lighttick" as const, userId: "tutor-generation-owner" };
const routeId = "plan-tutor-generation";
const content = [
  "## 引导问题\n怎样说明进度？",
  "## 概念\n结论要符合可核对的事实。",
  "## 示范\n用已经验证的事项与待核对事项说明进展。",
  "## 边界\n不把未知说成已确认。",
  "## 练习\n用一个事实支撑判断。",
  "## 参考分析\n只有已核对的事项可以作为确定的依据。",
  "## 自查\n每个依据是否有明确对象？",
  "## 记忆提示\n事实和判断分开。",
].join("\n\n");
const material = tutorMaterial(STRUCTURED_THINKING);
const provider = "fake";
const providerModel = "tutor-fixture";
const answer = "已核实 9 条，另有 3 条待补数据。";
const helpResponse = { message: "先说结论，再给依据。", next_step: "圈出一个确定的事实。", verdict: "help", answer_quote: "" };
const feedbackResponse = {
  message: "答案区分了已核实和待核实。",
  next_step: "再加一句你建议采取的行动。",
  verdict: "supported",
  answer_quote: "已核实 9 条",
};
const authorize = async () => {};

function gate() {
  let resolve!: () => void;
  const signal = new Promise<void>(ready => { resolve = ready; });
  return { resolve, signal };
}

function setup(reply?: (body: Record<string, any>) => Record<string, any> | Promise<Record<string, any>>) {
  let now = new Date("2026-11-04T08:00:00Z");
  let enabled = true;
  const repository = new InMemoryLightTickRepository();
  const native = new NativeLearningService(repository, true, () => now);
  const routes = new LearningRouteService(native);
  const work = new LearningWorkService(routes, new InMemoryJobQueue(), () => enabled);
  const tutor = new TutorWork(work);
  const calls: { body: Record<string, any>; request: LLMCompletionRequest }[] = [];
  const llm = {
    complete: async (request: LLMCompletionRequest) => {
      const instruction = request.messages[1]!.content;
      assert.equal(typeof instruction, "string");
      const body = JSON.parse(String(instruction).split("\nINPUT_JSON=")[1]!);
      calls.push({ body, request });
      const output = body.action
        ? reply ? await reply(body) : body.action === "feedback" ? feedbackResponse : helpResponse
        : body.lesson ? { content, references: body.sources[0].title } : routeFixture().document;
      return { provider, providerModel, modelKey: providerModel, text: JSON.stringify(output) };
    },
  };
  const runner = new LearningWorkRunner(work, llm, {
    readFile: async () => { throw new Error("Tutor fixtures do not read owner files."); },
    fetchUrl: async () => { throw new Error("Tutor fixtures do not fetch URLs."); },
  });
  return {
    repository, native, routes, work, tutor, calls, runner, llm,
    elapse: (ms: number) => { now = new Date(now.valueOf() + ms); },
    disable: () => { enabled = false; },
  };
}

async function publishFirstLesson(fixture: ReturnType<typeof setup>) {
  const proposedRoute = await fixture.work.create(owner, {
    kind: "route_draft", route_id: routeId, base_revision: 0,
    brief: routeFixture().brief, tutor_topic: STRUCTURED_THINKING,
  }, "tutor-first-route");
  await fixture.runner.execute(owner, proposedRoute.id);
  const routeDraft = await fixture.work.read(owner, proposedRoute.id);
  assert.equal(routeDraft.status, "succeeded", JSON.stringify(routeDraft));
  assert.equal(await fixture.repository.learningRoutes.getLearningRoute(owner, routeId), undefined);
  const adopted = await fixture.work.adopt(owner, routeDraft.id, {
    base_revision: routeDraft.revision, base_route_revision: 0, expected_digest: routeDraft.output_digest,
  }, "tutor-adopt-route");
  const route = await fixture.routes.publish(owner, routeId, { base_revision: adopted.result.revision }, "tutor-publish-route");
  const proposedLesson = await fixture.work.create(owner, {
    kind: "lesson_draft", route_id: routeId, base_revision: route.revision, number: 1, tutor_topic: STRUCTURED_THINKING,
  }, "tutor-first-lesson");
  await fixture.runner.execute(owner, proposedLesson.id);
  const lessonDraft = await fixture.work.read(owner, proposedLesson.id);
  assert.equal(lessonDraft.status, "succeeded", JSON.stringify(lessonDraft));
  assert.equal((await fixture.repository.learningRoutes.listRouteLessonLinks(owner, routeId)).length, 0);
  const lesson = await fixture.work.adopt(owner, lessonDraft.id, {
    base_revision: lessonDraft.revision, base_route_revision: route.revision, expected_digest: lessonDraft.output_digest,
  }, "tutor-adopt-lesson");
  assert.equal(fixture.calls[0]?.body.starter_scope.source, material.source.text);
  assert.equal(fixture.calls[1]?.body.sources[0].content, material.source.text);
  assert.equal(fixture.calls[1]?.body.model_selection, undefined);
  const { publication } = await fixture.native.publication(owner, lesson.result.id, lesson.result.content_version);
  assert.equal(publication.tutorTopic, STRUCTURED_THINKING);
  return { lessonId: publication.lessonId, version: publication.contentVersion };
}

function command(version: string, action: string, extra: Record<string, unknown> = {}) {
  return {
    content_version: version, action,
    concept_id: material.concept.id, question_id: material.question.id, consent: true,
    ...extra,
  };
}

async function saveAnswer(fixture: ReturnType<typeof setup>, lessonId: string, version: string, value: string, base: number) {
  return fixture.native.privateCommand(owner, lessonId, {
    content_version: version, action: "save", base_revision: base, notes: "Private notes stay local to the operation.",
    answers: [{ id: material.question.id, prompt: material.question.prompt, answer: value }],
  }, "tutor-answer-" + base);
}

test("first tutor publication and teaching actions reuse shared work and require an explicit saved answer", async () => {
  const f = setup();
  const { lessonId, version } = await publishFirstLesson(f);
  const reference = await f.tutor.submit(owner, lessonId, command(version, "reference", { consent: false }), "tutor-reference", authorize);
  await f.runner.execute(owner, reference.id);
  assert.equal(f.calls.length, 2, "Reading the reference analysis never calls the model");
  await assert.rejects(f.tutor.submit(owner, lessonId, command(version, "feedback", { answer_revision: 1 }), "tutor-no-answer", authorize));
  const state = await saveAnswer(f, lessonId, version, answer, 0);
  assert.equal(f.calls.length, 2, "Saving private data never calls the model");
  let parentId: string | undefined;
  for (const action of ["explain", "example", "hint", "ask"]) {
    const extra = action === "ask" ? { message: "依据怎样核对？", parent_id: parentId } : {};
    const turn = await f.tutor.submit(owner, lessonId, command(version, action, extra), "tutor-turn-" + action, authorize);
    await f.runner.execute(owner, turn.id);
    const result = await f.work.read(owner, turn.id);
    assert.equal(result.output?.verdict, "help");
    const call = f.calls.at(-1)!;
    assert.equal(call.body.action, action);
    assert.equal(call.body.submitted_answer, undefined, "Help never transfers the saved answer");
    assert.equal(call.request.providerOptions?.zookLogBodyMode, "suppress");
    assert.ok(!JSON.stringify(call.body).includes("Private notes"));
    if (action === "ask") assert.equal(call.body.previous.reply, helpResponse.message);
    parentId = turn.id;
  }
  const request = command(version, "feedback", { answer_revision: state.notes_revision });
  const queued = await f.tutor.submit(owner, lessonId, request, "tutor-feedback", authorize);
  await f.runner.execute(owner, queued.id);
  assert.deepEqual(await f.tutor.submit(owner, lessonId, request, "tutor-feedback", authorize), queued);
  await f.runner.execute(owner, queued.id);
  assert.equal(f.calls.length, 7, "Replay does not call the provider again");
  const final = await f.work.read(owner, queued.id);
  assert.equal(final.output?.answer_quote, feedbackResponse.answer_quote);
  assert.equal(f.calls.at(-1)!.body.submitted_answer, answer);
  assert.deepEqual(f.calls.at(-1)!.body.assistance, ["hint", "reference"]);
  assert.equal((await f.native.privateState(owner, lessonId, version)).completed, false);
  assert.equal((await f.work.list(owner)).items.some(row => row.kind === "tutor_turn"), false);
  assert.equal((await f.repository.listTasks(owner)).length, 0);
  await assert.rejects(f.work.read({ ...owner, userId: "other-tutor-owner" }, queued.id), { statusCode: 404 });
});

test("the next tutor lesson requires current completion, explicit publication, and a fresh authorization", async () => {
  const secondAnswer = "三个门店已确认，第四家还在核对库存。核对结束后我会补报。";
  const f = setup(() => ({ ...feedbackResponse, answer_quote: "三个门店已确认" }));
  const { lessonId, version } = await publishFirstLesson(f);
  const route = (await f.repository.learningRoutes.getLearningRoute(owner, routeId))!;
  const progress = () => routeProgress(f.native, owner, routeId, true);
  const request = { route_id: routeId, base_revision: route.revision, kind: "lesson_draft", number: 2,
    tutor_topic: STRUCTURED_THINKING_FOLLOWUP };
  const followup = tutorMaterial(STRUCTURED_THINKING_FOLLOWUP);
  assert.equal((await progress()).next_tutor_lesson, undefined);
  await assert.rejects(f.work.create(owner, request, "tutor-followup-incomplete"), { statusCode: 409 });
  await assert.rejects(f.work.create(owner, { ...request, number: 1 }, "tutor-followup-wrong-number"), { statusCode: 422 });
  await assert.rejects(f.work.create(owner, { ...request, sources: [] }, "tutor-followup-wrong-material"), { statusCode: 422 });
  await saveAnswer(f, lessonId, version, answer, 0);
  await f.native.privateCommand(owner, lessonId, { action: "complete", base_revision: 0, content_version: version }, "tutor-followup-complete-first");
  const firstState = await f.native.privateState(owner, lessonId, version);
  const firstPublication = await f.native.publication(owner, lessonId, version);
  assert.deepEqual((await progress()).next_tutor_lesson, { number: 2, tutor_topic: STRUCTURED_THINKING_FOLLOWUP,
    title: followup.title, source_title: followup.source.title });
  assert.equal((await routeProgress(f.native, owner, routeId)).next_tutor_lesson, undefined);
  f.elapse(24 * 60 * 60 * 1000);
  const original = await f.work.create(owner, request, "tutor-followup-create");
  const beforeWithdrawal = await f.work.create(owner, request, "tutor-followup-queued");
  await f.runner.execute(owner, original.id);
  const draft = await f.work.read(owner, original.id);
  assert.equal(draft.status, "succeeded");
  assert.equal(draft.tutor_topic, STRUCTURED_THINKING_FOLLOWUP);
  assert.equal(draft.lesson_number, 2);
  assert.equal((await progress()).published_lessons, 1);
  const prompt = f.calls.at(-1)!.body;
  assert.equal(prompt.sources[0].content, followup.source.text);
  assert.equal(prompt.starter_scope.concept.id, followup.concept.id);
  assert.equal(prompt.tutor_prerequisite, undefined);
  assert.doesNotMatch(JSON.stringify(prompt), /Private notes|已核实 9 条/);
  const adopt = (job: typeof draft, key: string) => f.work.adopt(owner, job.id, {
    base_revision: job.revision, base_route_revision: route.revision, expected_digest: job.output_digest,
  }, key);
  for (const privateEnabled of [false, true]) {
    const authority = (await f.native.authority(owner))!;
    await f.native.consent(owner, { base_revision: authority.revision, reading_enabled: true, private_enabled: privateEnabled },
      "tutor-followup-consent-" + privateEnabled);
    assert.equal(!!(await progress()).next_tutor_lesson, privateEnabled);
  }
  await assert.rejects(adopt(draft, "tutor-followup-reject-stale"), { statusCode: 409 });
  assert.equal((await f.work.read(owner, original.id)).error_code, "LEARNING_CONTEXT_STALE");
  await f.runner.execute(owner, beforeWithdrawal.id);
  assert.equal((await f.work.read(owner, beforeWithdrawal.id)).error_code, "LEARNING_CONTEXT_STALE");
  assert.equal(f.calls.length, 3);
  f.elapse(24 * 60 * 60 * 1000);
  const fresh = await f.work.create(owner, request, "tutor-followup-fresh");
  await f.runner.execute(owner, fresh.id);
  const published = (await adopt(await f.work.read(owner, fresh.id), "tutor-followup-publish")).result;
  const second = await f.native.publication(owner, published.id, published.content_version);
  assert.equal(second.publication.tutorTopic, STRUCTURED_THINKING_FOLLOWUP);
  const tutor = await f.tutor.read(owner, published.id, published.content_version);
  assert.deepEqual(tutor.turns, []);
  assert.notEqual(followup.question.id, material.question.id);
  const saved = await f.native.privateCommand(owner, published.id, {
    action: "save", base_revision: 0, content_version: published.content_version, notes: "",
    answers: [{ id: followup.question.id, prompt: followup.question.prompt, answer: secondAnswer }],
  }, "tutor-followup-save-second");
  const feedback = await f.tutor.submit(owner, published.id, { ...command(published.content_version, "feedback"),
    concept_id: followup.concept.id, question_id: followup.question.id, answer_revision: saved.notes_revision },
  "tutor-followup-feedback", authorize);
  await f.runner.execute(owner, feedback.id);
  assert.equal((await f.work.read(owner, feedback.id)).output?.answer_quote, "三个门店已确认");
  assert.equal(f.calls.at(-1)!.body.submitted_answer, secondAnswer);
  assert.equal((await progress()).next_tutor_lesson, undefined);
  assert.equal((await progress()).completed_lessons, 1);
  assert.deepEqual(await f.native.privateState(owner, lessonId, version), firstState);
  assert.deepEqual(await f.native.publication(owner, lessonId, version), firstPublication);
});

test("completed ordinary lessons do not open a tutor follow-up on mixed or imported courses", async () => {
  const f = setup();
  await f.routes.save(owner, routeId, { base_revision: 0, ...routeFixture() }, "tutor-mixed-route");
  await f.routes.publish(owner, routeId, { base_revision: 1 }, "tutor-mixed-publish");
  const first = await f.routes.publishLesson(owner, routeId, 1, {
    base_revision: 2, base_lesson_revision: 0, lesson_id: "lesson-tutor-mixed", content, references: "普通课程资料",
  }, "tutor-mixed-publish-lesson");
  await f.native.privateCommand(owner, first.id, {
    base_revision: 0, action: "complete", content_version: first.content_version,
  }, "tutor-mixed-complete");
  const progress = await routeProgress(f.native, owner, routeId, true);
  assert.equal(progress.completed_lessons, 1);
  assert.equal(progress.next_tutor_lesson, undefined);
  await assert.rejects(f.work.create(owner, { route_id: routeId, base_revision: 3, kind: "lesson_draft", number: 2,
    tutor_topic: STRUCTURED_THINKING_FOLLOWUP }, "tutor-mixed-no-followup"), { statusCode: 409 });
});

test("invalid or fabricated tutor feedback is terminal and saves no model output", async () => {
  const f = setup(() => ({ ...feedbackResponse, answer_quote: "结论有三条完整依据" }));
  const { lessonId, version } = await publishFirstLesson(f);
  const state = await saveAnswer(f, lessonId, version, answer, 0);
  const turn = await f.tutor.submit(owner, lessonId, command(version, "feedback", { answer_revision: state.notes_revision }), "tutor-invalid-quote", authorize);
  await f.runner.execute(owner, turn.id);
  const final = await f.work.read(owner, turn.id);
  assert.equal(final.status, "failed");
  assert.equal(final.error_code, "LEARNING_OUTPUT_INVALID");
  assert.equal(final.output, null);
  assert.equal(f.calls.length, 3);
});

test("future teaching uses only a separately authorized observation and cannot follow a revoked parent", async () => {
  const f = setup();
  const { lessonId, version } = await publishFirstLesson(f);
  const observation = new TutorObservations(f.work);
  const observe = (action: string, base: number, fields: Record<string, unknown> = {}) =>
    observation.command(owner, lessonId, { action, base_revision: base, content_version: version, ...fields },
      "tutor-observe-" + action + "-" + base, authorize);
  const saved = await saveAnswer(f, lessonId, version, answer, 0);
  const feedback = await f.tutor.submit(owner, lessonId, command(version, "feedback", { answer_revision: saved.notes_revision }),
    "tutor-observation-feedback", authorize);
  await f.runner.execute(owner, feedback.id);
  assert.equal((await observation.read(owner, lessonId, version)).status, "off");
  const fresh = await f.tutor.submit(owner, lessonId, command(version, "example"), "help-before-observation", authorize);
  await f.runner.execute(owner, fresh.id);
  assert.equal(f.calls.at(-1)!.body.learning_observation, undefined);

  await observe("allow", 0, { turn_id: feedback.id });
  await observe("correct", 1, { correction: "我想先练习说明目前无法判断的事项。" });
  const adapted = await f.tutor.submit(owner, lessonId, command(version, "hint"), "help-with-observation", authorize);
  await f.runner.execute(owner, adapted.id);
  const context = f.calls.at(-1)!.body;
  assert.equal(context.learning_observation.learner_correction, "我想先练习说明目前无法判断的事项。");
  assert.equal(context.learning_observation.practice_feedback, undefined);
  assert.equal(context.submitted_answer, undefined);
  assert.doesNotMatch(JSON.stringify(context), /Private notes|已核实 9 条/);

  await observe("stop", 2);
  assert.equal((await f.tutor.read(owner, lessonId, version)).turns.find(turn => turn.work.id === adapted.id)?.can_follow_up, false);
  await assert.rejects(
    f.tutor.submit(owner, lessonId, command(version, "ask", { message: "再说明一次", parent_id: adapted.id }),
      "help-revoked-parent", authorize), { statusCode: 409 },
  );
  const restarted = await f.tutor.submit(owner, lessonId, command(version, "ask", { message: "我怎么核对一个依据？" }),
    "help-after-observation", authorize);
  await f.runner.execute(owner, restarted.id);
  assert.equal(f.calls.at(-1)!.body.learning_observation, undefined);
  assert.equal(f.calls.at(-1)!.body.previous, undefined);
  assert.equal((await f.repository.listTasks(owner)).length, 0);
});

test("changing a saved answer, withdrawing consent or disabling tutor while feedback runs fences its result", { timeout: 15_000 }, async () => {
  for (const change of ["answer", "consent", "disabled"]) {
    const started = gate();
    const release = gate();
    const f = setup(async () => {
      started.resolve();
      await release.signal;
      return feedbackResponse;
    });
    const { lessonId, version } = await publishFirstLesson(f);
    const state = await saveAnswer(f, lessonId, version, answer, 0);
    const request = command(version, "feedback", { answer_revision: state.notes_revision });
    const turn = await f.tutor.submit(owner, lessonId, request, "tutor-pending-feedback", authorize);
    const running = f.runner.execute(owner, turn.id);
    await started.signal;
    if (change === "answer") await saveAnswer(f, lessonId, version, "这是一份新答案。", state.notes_revision);
    if (change === "disabled") f.disable();
    if (change === "consent") {
      const authority = (await f.native.authority(owner))!;
      await f.native.consent(owner, { base_revision: authority.revision, private_enabled: false, reading_enabled: true }, "tutor-consent-off");
      const latest = (await f.native.authority(owner))!;
      await f.native.consent(owner, { base_revision: latest.revision, private_enabled: true, reading_enabled: true }, "tutor-consent-on");
    }
    release.resolve();
    await running;
    const stored = await f.work.store.get(owner, turn.id);
    assert.equal(stored?.errorCode, "LEARNING_CONTEXT_STALE", change);
    assert.equal(stored?.output, null);
    if (change === "consent") {
      await assert.rejects(f.work.read(owner, turn.id), { statusCode: 403 });
      await assert.rejects(f.tutor.submit(owner, lessonId, request, "tutor-pending-feedback", authorize), { statusCode: 403 });
    }
    assert.equal(f.calls.length, 3, change);
  }
});

test("first-claim cancellation wins and an expired tutor invocation is never called again", { timeout: 15_000 }, async () => {
  for (const cancel of [true, false]) {
    const started = gate();
    const release = gate();
    const f = setup(async () => {
      started.resolve();
      await release.signal;
      return helpResponse;
    });
    const { lessonId, version } = await publishFirstLesson(f);
    const turn = await f.tutor.submit(owner, lessonId, command(version, "hint"), "tutor-lease-hint", authorize);
    const running = f.runner.execute(owner, turn.id);
    await started.signal;
    if (cancel) {
      await f.work.cancel(owner, turn.id, { base_revision: turn.revision }, "tutor-cancel-from-queued");
    } else {
      f.elapse(60_000);
      await new LearningWorkRunner(f.work, f.llm, f.runner.sources).execute(owner, turn.id);
    }
    release.resolve();
    await running;
    const stored = await f.work.read(owner, turn.id);
    assert.equal(stored.status, cancel ? "cancelled" : "failed");
    assert.equal(stored.error_code, cancel ? "CANCELLED" : "LEARNING_INVOCATION_UNKNOWN");
    assert.equal(stored.output, null);
    assert.equal(f.calls.length, 3);
  }
});

test("raw AI runs cannot bypass the tutor work service", async () => {
  const f = setup();
  const runner = new LightTickAiRunner(f.repository, f.llm);
  await assert.rejects(runner.execute(owner, "an-unowned-run", "learning_tutor"), { statusCode: 400 });
  assert.equal(f.calls.length, 0);
});
