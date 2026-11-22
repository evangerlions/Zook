import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { STRUCTURED_THINKING, tutorMaterial } from "../../src/modules/lighttick/learning/tutor-material.ts";
import { TutorWork } from "../../src/modules/lighttick/learning/tutor-work.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";

const connection = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!connection || !["localhost", "127.0.0.1"].includes(new URL(connection).hostname) ||
    !new URL(connection).pathname.startsWith("/grow_web_u1_"))
  throw Error("Disposable synthetic Grow database required");

test("PostgreSQL keeps older publications readable and tutor work scoped to owner, version, consent and deletion", async () => {
  await runPostgresMigrations({ connectionString: connection, log: () => {} });
  const pool = new Pool({ connectionString: connection });
  const owner = { appId: "lighttick" as const, userId: "tutor-owner-pg-" + process.pid };
  const other = { ...owner, userId: "tutor-other-pg-" + process.pid };
  const routeId = "plan-tutor-pg";
  const lessonId = "lesson-tutor-pg";
  const content = "## 概念\n先说结论。\n## 参考分析\n用两条可核实的事实支撑。\n## 自查\n检查数据。";
  const references = "LightTick 原创教学材料";
  const make = () => {
    const repo = new PostgresLightTickRepository(pool);
    const native = new NativeLearningService(repo, true);
    const routes = new LearningRouteService(native);
    const queue = new InMemoryJobQueue();
    const work = new LearningWorkService(routes, queue, () => false);
    return { repo, native, routes, queue, work, tutor: new TutorWork(work) };
  };
  const first = make();
  try {
    let plainVersion = "";
    let tutorVersion = "";
    for (const actor of [owner, other]) {
      await first.routes.save(actor, routeId, { base_revision: 0, ...routeFixture() }, "tutor-test-route-save");
      await first.routes.publish(actor, routeId, { base_revision: 1 }, "tutor-test-route-publish");
      const published = await first.routes.publishLesson(actor, routeId, 1, {
        base_revision: 2, base_lesson_revision: 0, lesson_id: lessonId, content, references,
      }, "tutor-test-plain");
      plainVersion = published.content_version;
      assert.equal(plainVersion, digest({ content, references }));
      await first.native.privateCommand(actor, lessonId, {
        action: "save", base_revision: 0, content_version: plainVersion, notes: "Earlier private note", answers: [],
      }, "tutor-test-original-note");
      const current = await first.routes.publishLesson(actor, routeId, 1, {
        base_revision: 3, base_lesson_revision: 1, lesson_id: lessonId, content, references,
      }, "tutor-test-current", undefined, STRUCTURED_THINKING);
      tutorVersion = current.content_version;
      assert.notEqual(tutorVersion, plainVersion);
    }
    const reconnect = make();
    const prior = await reconnect.native.publication(owner, lessonId, plainVersion);
    assert.equal(prior.publication.tutorTopic, null);
    assert.equal(prior.publication.content, content);
    assert.equal((await reconnect.native.privateState(owner, lessonId, plainVersion)).notes, "Earlier private note");
    const current = await reconnect.native.publication(owner, lessonId, tutorVersion);
    assert.equal(current.publication.tutorTopic, STRUCTURED_THINKING);
    await assert.rejects(reconnect.tutor.read(owner, lessonId, plainVersion), { statusCode: 404 });

    const material = tutorMaterial(STRUCTURED_THINKING);
    const reference = { content_version: tutorVersion, concept_id: material.concept.id, question_id: material.question.id, action: "reference" };
    const send = () => Promise.resolve();
    const observed = await reconnect.tutor.submit(owner, lessonId, reference, "tutor-test-reference-first", send);
    const observedOther = await reconnect.tutor.submit(other, lessonId, reference, "tutor-test-reference-first", send);
    assert.notEqual(observed.id, observedOther.id);
    assert.equal(observed.status, "succeeded");
    assert.deepEqual(reconnect.queue.jobs, []);
    assert.deepEqual((await first.tutor.read(owner, lessonId, tutorVersion)).turns.map(turn => turn.work.id), [observed.id]);
    assert.deepEqual((await first.tutor.read(other, lessonId, tutorVersion)).turns.map(turn => turn.work.id), [observedOther.id]);
    assert.equal((await first.tutor.read(other, lessonId, tutorVersion)).enabled, false);
    await assert.rejects(first.work.read(other, observed.id), { statusCode: 404 });
    assert.deepEqual((await first.work.list(owner)).items, []);

    for (const privateEnabled of [false, true]) {
      const authority = (await first.native.authority(owner))!;
      await first.native.consent(owner, {
        base_revision: authority.revision, reading_enabled: true, private_enabled: privateEnabled,
      }, "tutor-test-consent-" + privateEnabled);
      await assert.rejects(first.tutor.submit(owner, lessonId, reference, "tutor-test-reference-first", send), { statusCode: 403 });
    }
    assert.deepEqual((await first.tutor.read(owner, lessonId, tutorVersion)).turns, []);
    const updated = await first.tutor.submit(owner, lessonId, reference, "tutor-test-reference-new", send);
    assert.notEqual(updated.id, observed.id);
    assert.deepEqual((await first.tutor.read(owner, lessonId, tutorVersion)).turns.map(turn => turn.work.id), [updated.id]);

    await first.repo.deleteOwnerData(owner);
    assert.equal(await reconnect.repo.getLessonPublication(owner, lessonId, tutorVersion), undefined);
    assert.equal(await reconnect.repo.getNativePrivateState(owner, lessonId, plainVersion), undefined);
    assert.equal(await reconnect.work.store.get(owner, observed.id), undefined);
    assert.equal(await reconnect.work.store.get(owner, updated.id), undefined);
    assert.equal((await reconnect.native.publication(other, lessonId, tutorVersion)).publication.tutorTopic, STRUCTURED_THINKING);
    assert.equal((await reconnect.tutor.read(other, lessonId, tutorVersion)).turns[0].work.id, observedOther.id);
  } finally {
    for (const actor of [owner, other]) await first.repo.deleteOwnerData(actor);
    await pool.end();
  }
});
