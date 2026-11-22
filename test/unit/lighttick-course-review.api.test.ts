import { test } from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
test("course review HTTP contracts, core feedback/history/receipts, full AI, ownership and private revocation", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "course-review-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    runtime = app.services.lighttickRuntime!,
    repo = runtime.repository,
    native = new NativeLearningService(repo, true),
    o = { appId: "lighttick" as const, userId: "user_alice" };
  runtime.nativeLearning = native;
  runtime.learningWork = new LearningWorkService(
    new LearningRouteService(native),
    { add: async () => ({}) } as any,
  );
  await native.saveCollection(
    o,
    "course-http",
    { base_revision: 0, title: "HTTP course", archived: false },
    "http-collection-key",
  );
  const lesson = await native.publish(
    o,
    "lesson-course-http",
    {
      base_revision: 0,
      collection_id: "course-http",
      number: 1,
      title: "HTTP lesson",
      content: "# private body",
      references: "",
    },
    "http-publish-key",
  );
  await native.privateCommand(
    o,
    lesson.id,
    {
      action: "complete",
      content_version: lesson.content_version,
      base_revision: 0,
    },
    "http-complete-key",
  );
  const call = (
    method: string,
    path: string,
    body?: unknown,
    key = "http-request-key",
    user = "user_alice",
  ) =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/learning/" + path,
      body,
      headers: {
        authorization:
          "Bearer " +
          app.services.tokenService.issueAccessToken(user, "lighttick"),
        "x-app-id": "lighttick",
        "idempotency-key": key,
      },
    });
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const check = (name: string, body: unknown) => {
    const validate = ajv.compile(
      (schemas as any)[
        "LightTickNativeLearningCourseReview" + name + "EnvelopeSchema"
      ],
    );
    assert.equal(
      validate(JSON.parse(JSON.stringify(body))),
      true,
      JSON.stringify(validate.errors),
    );
  };
  const read = await call("GET", "course-reviews/course-http");
  assert.equal(read.statusCode, 200);
  assert.equal(read.headers["Cache-Control"], "no-store");
  check("", read.body);
  const body = {
    base_revision: 0,
    content_version: lesson.content_version,
    mastery_level: "basically_understood",
    value_rating: 2,
    feeling_tags: ["有启发"],
    key_learnings: "本人收获",
    questions: "待验证",
    next_direction: "练习方向",
  };
  runtime.scopePolicy.current = async () => "core";
  const feedback = await call(
    "PUT",
    "course-reviews/course-http/feedback/" + lesson.id,
    body,
    "http-feedback-key",
  );
  check("Feedback", feedback.body);
  assert.equal(feedback.statusCode, 200);
  const rejected = await call(
    "POST",
    "course-reviews/course-http/summaries",
    { base_revision: 1 },
    "http-summary-key",
  );
  assert.equal(rejected.statusCode, 503);
  runtime.scopePolicy.current = async () => "full";
  const job = await call(
    "POST",
    "course-reviews/course-http/summaries",
    { base_revision: 1 },
    "http-summary-key",
  );
  assert.equal(job.statusCode, 200, JSON.stringify(job.body));
  check("Summary", job.body);
  runtime.scopePolicy.current = async () => "core";
  const receipt = await call("GET", "course-review-requests/http-summary-key");
  check("Receipt", receipt.body);
  assert.equal(receipt.body.data.id, job.body.data.id);
  check(
    "History",
    (await call("GET", "course-reviews/course-http/summaries")).body,
  );
  assert.equal(
    (
      await call(
        "GET",
        "course-reviews/course-http",
        undefined,
        undefined,
        "user_bob",
      )
    ).statusCode,
    404,
  );
  const a = (await repo.getLearningAuthority(o))!;
  await repo.saveLearningAuthority(
    { ...a, privateEnabled: false, revision: a.revision + 1 },
    a.revision,
  );
  assert.equal(
    (await call("GET", "course-review-requests/http-summary-key")).statusCode,
    403,
  );
  assert.equal((await call("GET", "work/" + job.body.data.id)).statusCode, 403);
});
