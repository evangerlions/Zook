import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";

const owner = { appId: "lighttick" as const, userId: "user_alice" };

test("content modules are filterable and declared in the public contract", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "native-modules-user",
    appId: "lighttick",
    userId: owner.userId,
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
    key = "native-modules-key",
    query?: Record<string, string>,
  ) =>
    app.app.handle({
      path: "/api/v1/lighttick/" + path,
      method,
      body,
      query,
      headers: { ...headers, "idempotency-key": key },
    });

  const authority = (await call("learning/authority")).body.data;
  assert.equal(
    (
      await call(
        "learning/consent",
        "POST",
        {
          base_revision: authority.revision,
          reading_enabled: true,
          private_enabled: false,
        },
        "consent-modules",
      )
    ).statusCode,
    200,
  );

  const now = new Date().toISOString();
  // 模块必须先存在：collection 只引用已登记（或模板）的 module。
  for (const [mid, title, description] of [
    ["yingyu", "英语精读", "英文长文阅读"],
    ["shuxue", "数学思维", "数感与推理"],
  ] as const) {
    await runtime.repository.saveLearningModule({
      appId: "lighttick", userId: owner.userId, id: mid, title, description, enabled: true,
      sourceType: "manual", sourceUrl: null, sourcePath: null, revision: 0, createdAt: now, updatedAt: now,
    }, 0);
  }
  for (const [id, moduleId, title, description] of [
    ["collection-mod-yingyu", "yingyu", "英语精读", "英文长文阅读"],
    ["collection-mod-shuxue", "shuxue", "数学思维", "数感与推理"],
  ] as const) {
    const saved = await call(
      "learning/collections/" + id,
      "PUT",
      {
        base_revision: 0,
        title,
        description,
        module_id: moduleId,
        archived: false,
      },
      "save-" + id,
    );
    assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.module_id, moduleId);
    assert.equal(saved.body.data.description, description);
    check("Collection", saved.body);
  }

  for (const [id, moduleId, collectionId, title] of [
    ["lesson-mod-yingyu-1", "yingyu", "collection-mod-yingyu", "第一课"],
    ["lesson-mod-shuxue-1", "shuxue", "collection-mod-shuxue", "数学第一课"],
  ] as const)
    await runtime.repository.saveNativeLesson(
      {
        ...owner,
        id,
        moduleId,
        collectionId,
        number: 1,
        title,
        revision: 1,
        publishedVersion: null,
        archived: false,
        updatedAt: now,
      },
      0,
    );

  const filteredCollections = await call(
    "learning/collections",
    "GET",
    undefined,
    "list-collections-yingyu",
    { module_id: "yingyu" },
  );
  assert.equal(filteredCollections.statusCode, 200);
  assert.deepEqual(
    filteredCollections.body.data.items.map((r: any) => r.id),
    ["collection-mod-yingyu"],
  );
  check("Collections", filteredCollections.body);

  const filteredLessons = await call(
    "learning/lessons",
    "GET",
    undefined,
    "list-lessons-yingyu",
    { module_id: "yingyu" },
  );
  assert.equal(filteredLessons.statusCode, 200);
  assert.deepEqual(
    filteredLessons.body.data.items.map((r: any) => r.id),
    ["lesson-mod-yingyu-1"],
  );
  assert.equal(filteredLessons.body.data.items[0].module_id, "yingyu");
  check("Lessons", filteredLessons.body);

  for (const [id, title, description] of [
    ["yingyu", "英语精读", "英文长文阅读"],
    ["shuxue", "数学思维", "数感与推理"],
  ] as const)
    await runtime.repository.saveLearningModule(
      {
        ...owner,
        id,
        title,
        description,
        enabled: true,
        sourceType: "manual",
        sourceUrl: null,
        sourcePath: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
      0,
    );

  const modules = await call("learning/modules");
  assert.equal(modules.statusCode, 200, JSON.stringify(modules.body));
  assert.deepEqual(
    modules.body.data.items.map((r: any) => r.id),
    ["shuxue", "yingyu"],
  );
  assert.equal(modules.body.data.items[1].source_type, "manual");
  check("Modules", modules.body);
});
