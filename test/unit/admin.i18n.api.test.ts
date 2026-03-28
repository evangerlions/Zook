import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { DEFAULT_APP_I18N_SETTINGS } from "../../src/shared/i18n.ts";

function createAdminAuthHeader(username = "admin", password = "AdminPass123!"): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

test("admin i18n settings API exposes, updates, and restores app-scoped locale settings", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  const getResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/app_a/i18n-settings",
    headers,
  });

  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.body.data.app.appId, "app_a");
  assert.equal(getResponse.body.data.configKey, "i18n.settings");
  assert.equal(getResponse.body.data.revision, 1);
  assert.equal(getResponse.body.data.config.defaultLocale, DEFAULT_APP_I18N_SETTINGS.defaultLocale);
  assert.deepEqual(getResponse.body.data.config.supportedLocales, DEFAULT_APP_I18N_SETTINGS.supportedLocales);

  const updateResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/app_a/i18n-settings",
    headers,
    body: {
      desc: "enable-ja",
      config: {
        defaultLocale: "en-US",
        supportedLocales: ["en-US", "zh-CN", "ja-JP"],
        fallbackLocales: {
          "en-GB": ["en-US"],
          "zh-HK": ["zh-CN"],
        },
      },
    },
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.body.data.revision, 2);
  assert.equal(updateResponse.body.data.config.defaultLocale, "en-US");
  assert.deepEqual(updateResponse.body.data.config.supportedLocales, ["en-US", "zh-CN", "ja-JP"]);
  assert.deepEqual(updateResponse.body.data.config.fallbackLocales["zh-HK"], ["zh-CN"]);

  const revisionResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/app_a/i18n-settings/revisions/1",
    headers,
  });

  assert.equal(revisionResponse.statusCode, 200);
  assert.equal(revisionResponse.body.data.revision, 1);
  assert.equal(revisionResponse.body.data.isLatest, false);
  assert.equal(revisionResponse.body.data.config.defaultLocale, DEFAULT_APP_I18N_SETTINGS.defaultLocale);

  const restoreResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/app_a/i18n-settings/revisions/1/restore",
    headers,
  });

  assert.equal(restoreResponse.statusCode, 200);
  assert.equal(restoreResponse.body.data.revision, 3);
  assert.equal(restoreResponse.body.data.config.defaultLocale, DEFAULT_APP_I18N_SETTINGS.defaultLocale);
  assert.deepEqual(restoreResponse.body.data.config.supportedLocales, DEFAULT_APP_I18N_SETTINGS.supportedLocales);
});

test("creating a new app also initializes default i18n settings", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  const createResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps",
    headers,
    body: {
      appId: "app_c",
      appName: "App C",
    },
  });

  assert.equal(createResponse.statusCode, 200);

  const i18nResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/app_c/i18n-settings",
    headers,
  });

  assert.equal(i18nResponse.statusCode, 200);
  assert.equal(i18nResponse.body.data.revision, 1);
  assert.equal(i18nResponse.body.data.config.defaultLocale, DEFAULT_APP_I18N_SETTINGS.defaultLocale);
  assert.deepEqual(i18nResponse.body.data.config.supportedLocales, DEFAULT_APP_I18N_SETTINGS.supportedLocales);
});
