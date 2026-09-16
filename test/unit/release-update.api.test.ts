import assert from "node:assert/strict";
import test from "node:test";

import { createApplication } from "../support/create-test-application.ts";

function adminHeader(): string {
  return `Basic ${Buffer.from("admin:AdminPass123!").toString("base64")}`;
}

const releaseConfig = {
  schemaVersion: 1,
  products: {
    ai_novel: {
      targets: [
        {
          id: "android-direct",
          platform: "android",
          channel: "direct",
          delivery: "download",
          enabled: true,
          mandatory: true,
          latest: {
            version: "1.5.0",
            buildNumber: 1040101,
            packageName: "com.zhizhuokai.orangewrite",
            fileName: "OrangeWrite-1.5.0+1040101-cn.apk",
            downloadUrl: "https://cdn.example.com/ainovel/android.apk",
            sha256: "a".repeat(64),
            messageI18n: {
              "zh-CN": "优化章节编辑体验。",
              "en-US": "Improved chapter editing.",
            },
          },
          minimumSupported: { version: "1.4.0", buildNumber: 1040000 },
          reminder: { maxCount: 5, intervalSeconds: 3600 },
          experiments: [
            {
              id: "android-direct-canary",
              enabled: true,
              rolloutPercent: 10,
              artifact: {
                version: "1.5.1",
                buildNumber: 1050001,
                downloadUrl: "https://cdn.example.com/ainovel/android-canary.apk",
              },
            },
            {
              id: "android-direct-disabled",
              enabled: false,
              rolloutPercent: 100,
              artifact: {
                version: "1.5.2",
                buildNumber: 1050002,
                downloadUrl: "https://cdn.example.com/ainovel/android-disabled.apk",
              },
            },
          ],
        },
        {
          id: "ios-app-store",
          platform: "ios",
          channel: "app-store",
          delivery: "store",
          enabled: true,
          mandatory: false,
          latest: {
            version: "1.5.0",
            buildNumber: 1040101,
            storeUrl: "https://apps.apple.com/app/id123456789",
          },
          reminder: { maxCount: 1, intervalSeconds: 86400 },
          experiments: [],
        },
        {
          id: "windows-direct",
          platform: "windows",
          channel: "direct",
          delivery: "download",
          enabled: false,
          mandatory: false,
          latest: {
            version: "1.5.0",
            buildNumber: 1040101,
            fileName: "OrangeWrite-1.5.0+1040101-windows-setup.exe",
            downloadUrl: "https://cdn.example.com/ainovel/windows-setup.exe",
            sha256: "b".repeat(64),
          },
          experiments: [],
        },
      ],
    },
    app_b: {
      targets: [
        {
          id: "android-google-play",
          platform: "android",
          channel: "google-play",
          delivery: "store",
          enabled: true,
          mandatory: false,
          latest: {
            version: "2.0.0",
            buildNumber: 2000001,
            storeUrl: "https://play.google.com/store/apps/details?id=app.b",
          },
          experiments: [],
        },
      ],
    },
  },
};

test("release update admin config is revisioned and public output is product-scoped", async () => {
  const runtime = await createApplication({
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
  });
  const headers = { authorization: adminHeader() };

  const initial = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/common/release-updates",
    headers,
  });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.body.data.configKey, "common.release_updates");
  assert.deepEqual(initial.body.data.config, { schemaVersion: 1, products: {} });

  const updated = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/release-updates",
    headers,
    body: { config: releaseConfig, desc: "配置 AINovel 多平台升级包" },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.data.revision, 2);

  const ainovel = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/ai_novel/public/update",
    headers: { "x-app-id": "ai_novel" },
  });
  assert.equal(ainovel.statusCode, 200);
  assert.equal(ainovel.headers?.["Cache-Control"], "no-store");
  assert.equal(ainovel.body.data.appId, "ai_novel");
  assert.deepEqual(
    ainovel.body.data.config.targets.map((target: { id: string }) => target.id),
    ["android-direct", "ios-app-store"],
  );
  assert.deepEqual(
    ainovel.body.data.config.targets[0].experiments.map((item: { id: string }) => item.id),
    ["android-direct-canary"],
  );
  assert.equal(ainovel.body.data.config.targets[0].latest.downloadUrl, "https://cdn.example.com/ainovel/android.apk");
  assert.deepEqual(ainovel.body.data.config.targets[0].latest.messageI18n, {
    "zh-CN": "优化章节编辑体验。",
    "en-US": "Improved chapter editing.",
  });
  assert.deepEqual(ainovel.body.data.config.targets[0].reminder, { maxCount: 5, intervalSeconds: 3600 });
  assert.equal(ainovel.body.data.config.products, undefined);

  const ainovelConfig = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/ai_novel/public/config",
    headers: { "x-app-id": "ai_novel" },
  });
  assert.equal(ainovelConfig.statusCode, 200);
  assert.deepEqual(ainovelConfig.body.data.config.releaseUpdate, ainovel.body.data.config);

  const appB = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/app_b/public/update",
    headers: { "x-app-id": "app_b" },
  });
  assert.equal(appB.statusCode, 200);
  assert.deepEqual(appB.body.data.config.targets.map((target: { id: string }) => target.id), ["android-google-play"]);
  assert.equal(appB.body.data.config.targets[0].latest.storeUrl, "https://play.google.com/store/apps/details?id=app.b");

  const cleared = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/release-updates",
    headers,
    body: { config: { schemaVersion: 1, products: {} }, desc: "清空测试目录" },
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.body.data.revision, 3);

  const restored = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/release-updates/revisions/2/restore",
    headers,
    body: { desc: "恢复多平台目录" },
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.body.data.revision, 4);
  assert.equal(Object.keys(restored.body.data.config.products).sort().join(","), "ai_novel,app_b");
});

test("release update config rejects duplicate platform channels", async () => {
  const runtime = await createApplication({
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
  });
  const duplicate = structuredClone(releaseConfig);
  duplicate.products.ai_novel.targets.push({
    ...duplicate.products.ai_novel.targets[0],
    id: "android-direct-copy",
  });

  const response = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/release-updates",
    headers: { authorization: adminHeader() },
    body: duplicate,
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "REQ_INVALID_BODY");
});

test("release update config rejects legacy Windows ZIP artifacts", async () => {
  const runtime = await createApplication({
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
  });
  const invalid = structuredClone(releaseConfig);
  const windowsTarget = invalid.products.ai_novel.targets.find(
    (target: { id: string }) => target.id === "windows-direct",
  );
  windowsTarget.enabled = true;
  windowsTarget.latest.fileName = "OrangeWrite-windows.zip";

  const response = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/release-updates",
    headers: { authorization: adminHeader() },
    body: invalid,
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "REQ_INVALID_BODY");
});
