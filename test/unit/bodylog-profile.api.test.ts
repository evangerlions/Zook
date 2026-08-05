import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import type { DatabaseSeed } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

function bodyLogSeed(): DatabaseSeed {
  const seed = buildDefaultSeed();
  seed.apps?.push({
    id: "bodylog",
    code: "bodylog",
    name: "BodyLog",
    nameI18n: {
      "zh-CN": "BodyLog",
      "en-US": "BodyLog",
    },
    status: "ACTIVE",
    apiDomain: "bodylog.example.com",
    joinMode: "AUTO",
    createdAt: "2026-07-28T00:00:00.000Z",
  });
  seed.appUsers?.push({
    id: "app_user_alice_bodylog",
    appId: "bodylog",
    userId: "user_alice",
    status: "ACTIVE",
    joinedAt: "2026-07-28T00:00:00.000Z",
  });
  return seed;
}

function bodyLogSeedWithBlockedNickname(): DatabaseSeed {
  const seed = bodyLogSeed();
  seed.appConfigs?.push({
    id: "cfg_common_content_safety_bodylog_test",
    appId: "common",
    configKey: "common.content_safety",
    configValue: JSON.stringify({
      enabled: true,
      longTextThresholdChars: 2000,
      keyword: {
        enabled: true,
        rules: [{
          id: "bodylog_blocked",
          term: "违规昵称",
          enabled: true,
          category: "abuse",
        }],
      },
      llm: {
        enabled: false,
        modelKey: "qwen3.5-flash",
        timeoutMs: 5000,
      },
      aliyun: {
        enabled: false,
        endpoint: "https://green-cip.cn-shanghai.aliyuncs.com",
        region: "cn-shanghai",
        service: "chat_detection",
        accessKeyIdPasswordKey: "",
        accessKeySecretPasswordKey: "",
        timeoutMs: 5000,
      },
    }),
    updatedAt: "2026-07-28T00:00:00.000Z",
  });
  return seed;
}

test("bodylog profile is app scoped and update validates nickname", async () => {
  const runtime = await createApplication({ seed: bodyLogSeed() });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "bodylog",
  );

  const initial = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/bodylog/profile",
    headers: {
      authorization: `Bearer ${token}`,
      "x-app-id": "bodylog",
    },
  });

  assert.equal(initial.statusCode, 200);
  assert.equal(initial.body.data.userId, "user_alice");
  assert.equal(initial.body.data.profileCompleted, false);

  const updated = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/bodylog/profile",
    headers: {
      authorization: `Bearer ${token}`,
      "x-app-id": "bodylog",
    },
    body: {
      nickname: "薄荷同行者",
      avatarKey: "mint_runner",
    },
  });

  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.data.nickname, "薄荷同行者");
  assert.equal(updated.body.data.avatarKey, "mint_runner");
  assert.equal(updated.body.data.profileCompleted, true);

  const invalidNickname = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/bodylog/profile",
    headers: {
      authorization: `Bearer ${token}`,
      "x-app-id": "bodylog",
    },
    body: {
      nickname: "a",
      avatarKey: "mint_runner",
    },
  });
  assert.equal(invalidNickname.statusCode, 400);
  assert.equal(invalidNickname.body.code, "BODYLOG_NICKNAME_INVALID");

  const wrongScopeToken = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "app_a",
  );
  const wrongScope = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/bodylog/profile",
    headers: {
      authorization: `Bearer ${wrongScopeToken}`,
      "x-app-id": "app_a",
    },
  });
  assert.equal(wrongScope.statusCode, 403);
});

test("bodylog profile rejects an unsupported avatar", async () => {
  const runtime = await createApplication({ seed: bodyLogSeed() });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "bodylog",
  );

  const response = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/bodylog/profile",
    headers: {
      authorization: `Bearer ${token}`,
      "x-app-id": "bodylog",
    },
    body: {
      nickname: "Mint Friend",
      avatarKey: "uploaded_photo",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "BODYLOG_AVATAR_INVALID");
});

test("bodylog profile rejects a nickname blocked by content safety", async () => {
  const runtime = await createApplication({
    seed: bodyLogSeedWithBlockedNickname(),
  });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "bodylog",
  );

  const response = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/bodylog/profile",
    headers: {
      authorization: `Bearer ${token}`,
      "x-app-id": "bodylog",
    },
    body: {
      nickname: "这是违规昵称",
      avatarKey: "mint_runner",
    },
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.code, "BODYLOG_PROFILE_UNSAFE");
  assert.equal(
    runtime.database.findBodyLogProfile("bodylog", "user_alice"),
    undefined,
  );
});

test("deleting the BodyLog app account removes its server profile", async () => {
  const runtime = await createApplication({ seed: bodyLogSeed() });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "bodylog",
  );
  await runtime.database.upsertBodyLogProfile({
    appId: "bodylog",
    userId: "user_alice",
    nickname: "薄荷同行者",
    avatarKey: "mint_runner",
    profileCompleted: true,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
  });

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/users/me/delete",
    headers: {
      authorization: `Bearer ${token}`,
      "x-app-id": "bodylog",
    },
    body: {
      appId: "bodylog",
      confirmation: "DELETE",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(
    runtime.database.findBodyLogProfile("bodylog", "user_alice"),
    undefined,
  );
  assert.equal(
    runtime.database.findAppUser("bodylog", "user_alice")?.status,
    "DELETED",
  );
});
