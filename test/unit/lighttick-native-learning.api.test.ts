import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
const owner = { appId: "lighttick" as const, userId: "user_alice" };
test("canonical and legacy learning routes share native state without actions, Python or binding", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "native-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const app = await createApplication({ seed, lighttickEnabled: true }),
    runtime = app.services.lighttickRuntime!;
  runtime.nativeLearning = new NativeLearningService(runtime.repository, true);
  runtime.actionsEnabled = false;
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const check = (name: string, value: unknown) => {
    const validate = ajv.compile(
      (schemas as any)["LightTickNativeLearning" + name + "EnvelopeSchema"],
    );
    assert.equal(
      validate(JSON.parse(JSON.stringify(value))),
      true,
      JSON.stringify(validate.errors),
    );
  };
  const headers = {
    authorization:
      "Bearer " +
      app.services.tokenService.issueAccessToken(owner.userId, "lighttick"),
    "x-app-id": "lighttick",
  };
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key = "native-learning-key",
    override: Record<string, string> = {},
  ) =>
    app.app.handle({
      path: "/api/v1/lighttick/" + path,
      method,
      body,
      headers: { ...headers, "idempotency-key": key, ...override },
    });
  assert.equal((await call("learning/authority")).statusCode, 200);
  assert.equal(
    (
      await call(
        "learning/collections/collection-native-api",
        "PUT",
        { title: "Native API", archived: false, base_revision: 0 },
        "create-collection-api",
      )
    ).statusCode,
    200,
  );
  const response = await call(
    "learning/lessons/lesson-native-api/publications",
    "PUT",
    {
      collection_id: "collection-native-api",
      number: 1,
      title: "API lesson",
      content: "Body",
      references: "",
      base_revision: 0,
    },
    "publish-lesson-api",
  );
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  check("Publish", response.body);
  const lesson = response.body.data as any,
    v = lesson.content_version;
  assert.equal(
    (await call("learning-library")).body.data.consent_enabled,
    true,
  );
  const before = await call("learning-library/" + lesson.id + "/private");
  assert.equal(before.statusCode, 200);
  assert.equal(before.body.data.state.completed, false);
  const body = {
    id: "legacy-native-api-save",
    content_version: v,
    revision: 1,
    action: "save",
    notes: "Phone note",
    answers: [],
    position: 0,
  };
  const saved = await call(
    "learning-library/" + lesson.id + "/private",
    "POST",
    body,
  );
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.operations[0].status, "applied");
  const read = await app.app.handle({
    method: "GET",
    path: "/api/v1/lighttick/learning/lessons/" + lesson.id + "/private",
    headers,
    query: { content_version: v },
  });
  assert.equal(read.body.data.notes, "Phone note");
  check("Private", read.body);
  check("Collections", (await call("learning/collections")).body);
  check("Lessons", (await call("learning/lessons")).body);
  check(
    "Publication",
    (await call("learning/lessons/" + lesson.id + "/versions/" + v)).body,
  );
  const history = await app.app.handle({
    method: "GET",
    path:
      "/api/v1/lighttick/learning/lessons/" + lesson.id + "/private-history",
    headers,
    query: { content_version: v },
  });
  check("History", history.body);
  const bob = {
    authorization:
      "Bearer " +
      app.services.tokenService.issueAccessToken("user_bob", "lighttick"),
  };
  assert.equal(
    (
      await call(
        "learning/lessons/" + lesson.id + "/versions/" + v,
        "GET",
        undefined,
        "read",
        bob,
      )
    ).statusCode,
    404,
  );
  runtime.nativeLearning = new NativeLearningService(runtime.repository, false);
  assert.equal(
    (await call("learning-library/" + lesson.id + "/private", "POST", body))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "learning/collections/collection-native-api",
        "PUT",
        { title: "Disabled", archived: false, base_revision: 1 },
        "disabled-new-key",
      )
    ).statusCode,
    503,
  );
  await app.database.updateAppUserStatus("lighttick", owner.userId, "BLOCKED");
  assert.equal(
    (await call("learning-library/" + lesson.id + "/private", "POST", body))
      .statusCode,
    403,
  );
});
