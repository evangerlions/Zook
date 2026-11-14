import test from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickNativeLearningReviewEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
test("learning review HTTP contract: private owner, no-store, validation, revoked consent, read-only recovery in core", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "notebook-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    runtime = app.services.lighttickRuntime!,
    repo = runtime.repository;
  const native = new NativeLearningService(repo, true);
  runtime.nativeLearning = native;
  const owner = { appId: "lighttick" as const, userId: "user_alice" };
  await native.saveCollection(
    owner,
    "notebook-collection",
    { base_revision: 0, title: "Notebook course", archived: false },
    "notebook-create",
  );
  const lesson = await native.publish(
    owner,
    "lesson-notebook-http",
    {
      base_revision: 0,
      collection_id: "notebook-collection",
      number: 1,
      title: "Exact course",
      content: "# Body",
      references: "",
    },
    "notebook-publish",
  );
  await native.privateCommand(
    owner,
    lesson.id,
    {
      action: "save",
      content_version: lesson.content_version,
      base_revision: 0,
      notes: "private HTTP notebook",
      answers: [],
    },
    "notebook-save",
  );
  const call = (
    query: Record<string, string> = {},
    user = "user_alice",
    headers: Record<string, string> = {},
  ) =>
    app.app.handle({
      method: "GET",
      path: "/api/v1/lighttick/learning/review",
      query,
      headers: {
        authorization:
          "Bearer " +
          app.services.tokenService.issueAccessToken(user, "lighttick"),
        "x-app-id": "lighttick",
        ...headers,
      },
    });
  const before = await repo.getNativeLearningCounts(owner),
    first = await call();
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.headers?.["Cache-Control"], "no-store");
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(LightTickNativeLearningReviewEnvelopeSchema);
  assert.equal(
    validate(JSON.parse(JSON.stringify(first.body))),
    true,
    JSON.stringify(validate.errors),
  );
  assert.equal((first.body.data as any).summary.completed_lessons, 0);
  assert.equal(
    JSON.stringify(first.body).includes("private HTTP notebook"),
    false,
  );
  assert.equal(
    (await call({}, "user_bob")).body.data.summary.completed_lessons,
    0,
  );
  assert.equal((await call({ month: "2026-13" })).statusCode, 422);
  assert.equal(
    (await call({}, "user_alice", { authorization: "" })).statusCode,
    401,
  );
  assert.deepEqual(await repo.getNativeLearningCounts(owner), before);
  runtime.scopePolicy.assertFull = async () => {
    throw Error("No full-only capability may be used by notebook reads");
  };
  assert.equal((await call()).statusCode, 200);
  const authority = (await repo.getLearningAuthority(owner))!;
  await repo.saveLearningAuthority(
    { ...authority, privateEnabled: false, revision: authority.revision + 1 },
    authority.revision,
  );
  assert.equal((await call()).body.data.private_coverage, "not_authorized");
});
