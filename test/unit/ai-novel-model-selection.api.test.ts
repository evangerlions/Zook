import assert from "node:assert/strict";
import test from "node:test";

import { createApplication } from "../support/create-test-application.ts";
import { ApplicationError } from "../../src/shared/errors.ts";

function createRuntime() {
  return createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
}

function adminAuthorization(): string {
  return `Basic ${Buffer.from("admin:AdminPass123!").toString("base64")}`;
}

function request(
  runtime: Awaited<ReturnType<typeof createApplication>>,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: Record<string, unknown>,
) {
  return runtime.app.handle({
    method,
    path,
    headers: { authorization: adminAuthorization() },
    ...(body ? { body } : {}),
  });
}

test("AINovel model selection defaults to qwen3.6-plus without stored config", async () => {
  const runtime = await createRuntime();
  const response = await request(
    runtime,
    "GET",
    "/api/v1/admin/apps/ai_novel/model-selection",
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.configKey, "ai_novel.model_selection");
  assert.deepEqual(response.body.data.config, {
    schemaVersion: 1,
    chat: {
      default: [{ modelKey: "qwen3.6-plus", weight: 100 }],
    },
  });
  assert.equal(response.body.data.revision, undefined);
  assert.ok(
    response.body.data.availableChatModels.some(
      (model: { key: string }) => model.key === "qwen3.6-plus",
    ),
  );
});

test("AINovel model selection saves weighted models and restores revisions", async () => {
  const runtime = await createRuntime();
  const path = "/api/v1/admin/apps/ai_novel/model-selection";

  const first = await request(runtime, "PUT", path, {
    config: {
      schemaVersion: 1,
      chat: {
        default: [{ modelKey: "qwen3.5-flash", weight: 100 }],
      },
    },
    desc: "use flash",
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.data.revision, 1);
  assert.equal(
    await runtime.services.aiNovelModelSelectionConfigService.resolveChatModelKey(
      { did: "device_abc", uid: "user_001" },
    ),
    "qwen3.5-flash",
  );

  const second = await request(runtime, "PUT", path, {
    config: {
      schemaVersion: 1,
      chat: {
        default: [
          { modelKey: "qwen3.6-plus", weight: 50 },
          { modelKey: "openrouter-free", weight: 50 },
        ],
      },
    },
    desc: "split default traffic",
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.data.revision, 2);
  const selected =
    await runtime.services.aiNovelModelSelectionConfigService.resolveChatModelKey(
      { did: "device_abc", uid: "user_001" },
    );
  assert.ok(["qwen3.6-plus", "openrouter-free"].includes(selected));
  assert.equal(
    await runtime.services.aiNovelModelSelectionConfigService.resolveChatModelKey(
      { did: "device_abc", uid: "user_001" },
    ),
    selected,
  );

  const revision = await request(runtime, "GET", `${path}/revisions/1`);
  assert.equal(revision.statusCode, 200);
  assert.deepEqual(revision.body.data.config.chat.default, [
    { modelKey: "qwen3.5-flash", weight: 100 },
  ]);

  const restored = await request(runtime, "POST", `${path}/revisions/1/restore`, {
    desc: "restore flash",
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.body.data.revision, 3);
  assert.deepEqual(restored.body.data.config.chat.default, [
    { modelKey: "qwen3.5-flash", weight: 100 },
  ]);
});

test("AINovel model selection rejects invalid model arrays", async () => {
  const runtime = await createRuntime();
  const path = "/api/v1/admin/apps/ai_novel/model-selection";

  const unsupportedScene = await request(runtime, "PUT", path, {
    config: {
      schemaVersion: 1,
      chat: {
        default: [{ modelKey: "qwen3.6-plus", weight: 100 }],
        write_turn: [{ modelKey: "qwen3.5-flash", weight: 100 }],
      },
    },
  });
  assert.equal(unsupportedScene.statusCode, 400);
  assert.equal(
    unsupportedScene.body.code,
    "ADMIN_AINOVEL_MODEL_SELECTION_INVALID",
  );

  const duplicateModel = await request(runtime, "PUT", path, {
    config: {
      schemaVersion: 1,
      chat: {
        default: [
          { modelKey: "qwen3.6-plus", weight: 50 },
          { modelKey: "qwen3.6-plus", weight: 50 },
        ],
      },
    },
  });
  assert.equal(duplicateModel.statusCode, 400);
  assert.equal(
    duplicateModel.body.code,
    "ADMIN_AINOVEL_MODEL_SELECTION_INVALID",
  );

  const embeddingModel = await request(runtime, "PUT", path, {
    config: {
      schemaVersion: 1,
      chat: {
        default: [{ modelKey: "text-embedding-v4", weight: 100 }],
      },
    },
  });
  assert.equal(embeddingModel.statusCode, 400);
  assert.equal(
    embeddingModel.body.code,
    "ADMIN_AINOVEL_MODEL_SELECTION_INVALID",
  );

  const invalidTotal = await request(runtime, "PUT", path, {
    config: {
      schemaVersion: 1,
      chat: {
        default: [
          { modelKey: "qwen3.6-plus", weight: 70 },
          { modelKey: "qwen3.5-flash", weight: 20 },
        ],
      },
    },
  });
  assert.equal(invalidTotal.statusCode, 400);
  assert.equal(
    invalidTotal.body.code,
    "ADMIN_AINOVEL_MODEL_SELECTION_INVALID",
  );

  const missingModel = await request(runtime, "PUT", path, {
    config: {
      schemaVersion: 1,
      chat: {
        default: [{ modelKey: "missing-chat-model", weight: 100 }],
      },
    },
  });
  assert.equal(missingModel.statusCode, 400);
  assert.equal(
    missingModel.body.code,
    "ADMIN_AINOVEL_MODEL_SELECTION_INVALID",
  );
});

test("AINovel runtime rejects a damaged stored selection instead of using the default", async () => {
  const runtime = await createRuntime();
  await runtime.services.appConfigService.setValue(
    "ai_novel",
    "ai_novel.model_selection",
    JSON.stringify({ schemaVersion: 1, chat: { default: [] } }),
    "damaged config",
  );

  await assert.rejects(
    () =>
      runtime.services.aiNovelModelSelectionConfigService.resolveChatModelKey(),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.statusCode === 502 &&
      error.code === "AI_UPSTREAM_CONFIG_INVALID",
  );
});
