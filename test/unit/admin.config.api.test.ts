import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";

function createAdminAuthHeader(username = "admin", password = "AdminPass123!"): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

test("admin bootstrap and config APIs expose app list and editable JSON config", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  const bootstrapResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/bootstrap",
    headers,
  });

  assert.equal(bootstrapResponse.statusCode, 200);
  assert.equal(bootstrapResponse.body.data.adminUser, "admin");
  assert.equal(bootstrapResponse.body.data.apps.length, 2);
  assert.deepEqual(
    bootstrapResponse.body.data.apps.map((item) => item.appId),
    ["app_a", "app_b"],
  );
  assert.equal(bootstrapResponse.body.data.apps[0]?.canDelete, false);

  const configResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/app_a/config",
    headers,
  });

  assert.equal(configResponse.statusCode, 200);
  assert.equal(configResponse.body.data.app.appId, "app_a");
  assert.equal(configResponse.body.data.configKey, "admin.delivery_config");
  assert.equal(configResponse.body.data.revision, 1);
  assert.equal(configResponse.body.data.isLatest, true);
  assert.equal(configResponse.body.data.revisions.length, 1);
  assert.match(configResponse.body.data.rawJson, /featureFlags/);
});

test("admin config API saves normalized JSON back to the app config store", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };
  const now = new Date();

  const updateResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/app_b/config",
    headers,
    body: {
      rawJson: '{"release":{"version":"2026.03.21","channel":"stable"},"featureFlags":{"enableVipBanner":false},"settings":{"theme":"dawn"}}',
      desc: "发布稳定版本",
    },
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.body.data.app.appId, "app_b");
  assert.equal(updateResponse.body.data.revision, 2);
  assert.equal(updateResponse.body.data.desc, "发布稳定版本");
  assert.equal(updateResponse.body.data.isLatest, true);
  assert.equal(updateResponse.body.data.revisions.length, 2);
  assert.match(updateResponse.body.data.rawJson, /2026\.03\.21/);
  assert.ok(
    runtime.database.auditLogs.some(
      (item) => item.action === "admin.config.update" && item.appId === "app_b",
    ),
  );

  const storedValue = runtime.services.appConfigService.getValue("app_b", "admin.delivery_config");
  assert.equal(
    storedValue,
    JSON.stringify(
      {
        release: {
          version: "2026.03.21",
          channel: "stable",
        },
        featureFlags: {
          enableVipBanner: false,
        },
        settings: {
          theme: "dawn",
        },
      },
      null,
      2,
    ),
  );
});

test("admin config API exposes revision history and can restore a historical version", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/app_b/config",
    headers,
    body: {
      rawJson: '{"release":{"version":"2026.03.21"}}',
      desc: "v1",
    },
  });

  const secondUpdate = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/app_b/config",
    headers,
    body: {
      rawJson: '{"release":{"version":"2026.03.22"}}',
      desc: "v2",
    },
  });

  assert.equal(secondUpdate.statusCode, 200);
  assert.equal(secondUpdate.body.data.revision, 3);
  assert.deepEqual(
    secondUpdate.body.data.revisions.map((item) => item.revision),
    [3, 2, 1],
  );

  const revisionOneResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/app_b/config/revisions/1",
    headers,
  });

  assert.equal(revisionOneResponse.statusCode, 200);
  assert.equal(revisionOneResponse.body.data.revision, 1);
  assert.equal(revisionOneResponse.body.data.isLatest, false);
  assert.match(revisionOneResponse.body.data.rawJson, /featureFlags/);

  const restoreResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/app_b/config/revisions/1/restore",
    headers,
  });

  assert.equal(restoreResponse.statusCode, 200);
  assert.equal(restoreResponse.body.data.revision, 4);
  assert.equal(restoreResponse.body.data.isLatest, true);
  assert.equal(restoreResponse.body.data.desc, "恢复到版本 R1");
  assert.match(restoreResponse.body.data.rawJson, /featureFlags/);
});

test("admin config API rejects invalid JSON and missing basic auth", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });

  const unauthorizedResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/bootstrap",
    headers: {},
  });

  assert.equal(unauthorizedResponse.statusCode, 401);
  assert.equal(unauthorizedResponse.body.code, "ADMIN_BASIC_AUTH_REQUIRED");

  const invalidJsonResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/app_a/config",
    headers: {
      authorization: createAdminAuthHeader(),
    },
    body: {
      rawJson: '{"featureFlags": }',
    },
  });

  assert.equal(invalidJsonResponse.statusCode, 400);
  assert.equal(invalidJsonResponse.body.code, "ADMIN_CONFIG_INVALID_JSON");
});

test("admin app APIs can add new apps and only delete apps with empty config", async () => {
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
  assert.equal(createResponse.body.data.appId, "app_c");
  assert.equal(createResponse.body.data.appName, "App C");
  assert.equal(createResponse.body.data.canDelete, true);
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "admin.app.create" && item.appId === "app_c"),
  );

  const createdConfigResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/app_c/config",
    headers,
  });

  assert.equal(createdConfigResponse.statusCode, 200);
  assert.equal(createdConfigResponse.body.data.rawJson, "{}");

  const blockedDeleteResponse = await runtime.app.handle({
    method: "DELETE",
    path: "/api/v1/admin/apps/app_a",
    headers,
  });

  assert.equal(blockedDeleteResponse.statusCode, 409);
  assert.equal(blockedDeleteResponse.body.code, "ADMIN_APP_DELETE_REQUIRES_EMPTY_CONFIG");

  const deleteResponse = await runtime.app.handle({
    method: "DELETE",
    path: "/api/v1/admin/apps/app_c",
    headers,
  });

  assert.equal(deleteResponse.statusCode, 200);
  assert.equal(deleteResponse.body.data.deleted, true);
  assert.equal(runtime.database.findApp("app_c"), undefined);
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "admin.app.delete" && item.appId === "app_c"),
  );
});

test("admin email service API stores common config and exposes resolved region", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };
  const now = new Date();

  const updateResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/email-service",
    headers,
    body: {
      enabled: true,
      secretId: "sid-demo",
      secretKey: "sk-demo",
      desc: "初始化邮件服务",
      senders: [
        {
          id: "default",
          address: "Admin <noreply@example.com>",
        },
        {
          id: "support",
          address: "Support <support@example.com>",
        },
      ],
      templates: [
        {
          locale: "zh-CN",
          templateId: 100001,
          name: "验证码",
        },
        {
          locale: "en-US",
          templateId: 100002,
          name: "Verification Code",
        },
      ],
    },
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.body.data.app.appId, "common");
  assert.equal(updateResponse.body.data.resolvedRegion, "ap-guangzhou");
  assert.equal(updateResponse.body.data.config.enabled, true);
  assert.equal(updateResponse.body.data.revision, 1);
  assert.equal(updateResponse.body.data.isLatest, true);
  assert.equal(updateResponse.body.data.desc, "初始化邮件服务");
  assert.equal(updateResponse.body.data.revisions.length, 1);
  assert.equal(updateResponse.body.data.config.senders[0]?.id, "default");
  assert.equal(updateResponse.body.data.config.senders[1]?.address, "Support <support@example.com>");
  assert.equal(updateResponse.body.data.config.templates[0]?.templateId, 100001);
  assert.equal(updateResponse.body.data.config.templates[1]?.locale, "en-US");
  assert.equal(updateResponse.body.data.config.templates[1]?.name, "Verification Code");

  const fetchResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/common/email-service",
    headers,
  });

  assert.equal(fetchResponse.statusCode, 200);
  assert.equal(fetchResponse.body.data.config.secretId, "sid-****");
  assert.equal(fetchResponse.body.data.config.secretKey, "sk-d****");
  assert.equal(runtime.services.commonEmailConfigService.getRuntimeConfig().config.secretId, "sid-demo");
  assert.equal(runtime.services.commonEmailConfigService.getRuntimeConfig().config.secretKey, "sk-demo");

  const maskedUpdateResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/email-service",
    headers,
    body: {
      ...fetchResponse.body.data.config,
      desc: "补充中文模板",
      templates: [
        ...fetchResponse.body.data.config.templates,
        {
          locale: "zh",
          templateId: 100003,
          name: "验证码简体",
        },
      ],
    },
  });

  assert.equal(maskedUpdateResponse.statusCode, 200);
  assert.equal(maskedUpdateResponse.body.data.revision, 2);
  assert.equal(maskedUpdateResponse.body.data.desc, "补充中文模板");
  assert.deepEqual(
    maskedUpdateResponse.body.data.revisions.map((item) => item.revision),
    [2, 1],
  );
  assert.equal(runtime.services.commonEmailConfigService.getRuntimeConfig().config.secretId, "sid-demo");
  assert.equal(runtime.services.commonEmailConfigService.getRuntimeConfig().config.secretKey, "sk-demo");
  assert.equal(
    runtime.services.commonEmailConfigService.getRuntimeConfig("en-US", "support").sender.address,
    "Support <support@example.com>",
  );
  assert.equal(runtime.services.commonEmailConfigService.getRuntimeConfig("en-US").template.name, "Verification Code");
  assert.equal(runtime.services.commonEmailConfigService.getRuntimeConfig("en-US").template.templateId, 100002);
  assert.equal(runtime.services.commonEmailConfigService.getRuntimeConfig("zh-TW").template.templateId, 100003);

  const revisionOneResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/common/email-service/revisions/1",
    headers,
  });

  assert.equal(revisionOneResponse.statusCode, 200);
  assert.equal(revisionOneResponse.body.data.revision, 1);
  assert.equal(revisionOneResponse.body.data.isLatest, false);
  assert.equal(revisionOneResponse.body.data.config.templates.length, 2);

  const restoreResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/email-service/revisions/1/restore",
    headers,
  });

  assert.equal(restoreResponse.statusCode, 200);
  assert.equal(restoreResponse.body.data.revision, 3);
  assert.equal(restoreResponse.body.data.isLatest, true);
  assert.equal(restoreResponse.body.data.desc, "恢复到版本 R1");
  assert.equal(restoreResponse.body.data.config.templates.length, 2);
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "admin.email_service.update" && item.appId === "common"),
  );
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "admin.email_service.restore" && item.appId === "common"),
  );
});

test("admin email service API rejects invalid sender address format", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  const response = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/email-service",
    headers,
    body: {
      enabled: true,
      secretId: "sid-demo",
      secretKey: "sk-demo",
      senders: [
        {
          id: "default",
          address: "not-an-email",
        },
      ],
      templates: [
        {
          locale: "zh-CN",
          templateId: 100001,
          name: "验证码",
        },
      ],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "ADMIN_EMAIL_SERVICE_INVALID");
  assert.match(response.body.message, /Sender address format is invalid/);
});

test("admin llm service API stores versioned common config and exposes metrics", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };
  const now = new Date();

  const updateResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/llm-service",
    headers,
    body: {
      enabled: true,
      defaultModelKey: "kimi2.5",
      desc: "初始化 LLM 服务",
      providers: [
        {
          key: "bailian",
          label: "阿里云百炼",
          enabled: true,
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          apiKey: "mock-bailian-api-key",
          timeoutMs: 30000,
        },
        {
          key: "volcengine",
          label: "火山引擎",
          enabled: true,
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
          apiKey: "mock-volcengine-api-key",
          timeoutMs: 30000,
        },
      ],
      models: [
        {
          key: "kimi2.5",
          label: "Kimi 2.5",
          strategy: "auto",
          routes: [
            {
              provider: "bailian",
              providerModel: "kimi/kimi-k2.5",
              enabled: true,
              weight: 80,
            },
            {
              provider: "volcengine",
              providerModel: "kimi-2.5",
              enabled: true,
              weight: 20,
            },
          ],
        },
      ],
    },
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.body.data.revision, 1);
  assert.equal(updateResponse.body.data.config.providers[0]?.apiKey, "mock****");
  assert.equal(updateResponse.body.data.runtime.models[0]?.routes.length, 2);

  await runtime.services.llmMetricsService.recordCall({
    modelKey: "kimi2.5",
    provider: "bailian",
    providerModel: "kimi/kimi-k2.5",
    ok: true,
    firstByteLatencyMs: 120,
    totalLatencyMs: 500,
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    },
    occurredAt: now,
  });
  await runtime.services.llmMetricsService.recordCall({
    modelKey: "kimi2.5",
    provider: "volcengine",
    providerModel: "kimi-2.5",
    ok: false,
    firstByteLatencyMs: 300,
    totalLatencyMs: 900,
    occurredAt: now,
  });

  const metricsResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/common/llm-service/metrics",
    headers,
    query: {
      range: "24h",
    },
  });

  assert.equal(metricsResponse.statusCode, 200);
  assert.equal(metricsResponse.body.data.summary.requestCount, 2);
  assert.equal(metricsResponse.body.data.summary.successRate, 50);
  assert.equal(metricsResponse.body.data.models[0]?.modelKey, "kimi2.5");

  const detailResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/common/llm-service/metrics/models/kimi2.5",
    headers,
    query: {
      range: "24h",
    },
  });

  assert.equal(detailResponse.statusCode, 200);
  assert.equal(detailResponse.body.data.routes.length, 2);
  assert.equal(detailResponse.body.data.routes[0]?.provider, "bailian");

  const revisionResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/common/llm-service/revisions/1",
    headers,
  });

  assert.equal(revisionResponse.statusCode, 200);
  assert.equal(revisionResponse.body.data.isLatest, true);

  const secondUpdate = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/llm-service",
    headers,
    body: {
      ...updateResponse.body.data.config,
      desc: "切换到固定路由",
      models: [
        {
          ...updateResponse.body.data.config.models[0],
          strategy: "fixed",
        },
      ],
    },
  });

  assert.equal(secondUpdate.statusCode, 200);
  assert.equal(secondUpdate.body.data.revision, 2);

  const restoreResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/llm-service/revisions/1/restore",
    headers,
  });

  assert.equal(restoreResponse.statusCode, 200);
  assert.equal(restoreResponse.body.data.revision, 3);
  assert.equal(restoreResponse.body.data.config.models[0]?.strategy, "auto");
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "admin.llm_service.update" && item.appId === "common"),
  );
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "admin.llm_service.restore" && item.appId === "common"),
  );
});

test("admin llm smoke test API requires admin auth and enforces global cooldown", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/llm-service",
    headers,
    body: {
      enabled: true,
      defaultModelKey: "kimi2.5",
      providers: [
        {
          key: "volcengine",
          label: "火山引擎",
          enabled: true,
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
          apiKey: "mock-volcengine-api-key",
          timeoutMs: 30000,
        },
      ],
      models: [
        {
          key: "kimi2.5",
          label: "Kimi 2.5",
          strategy: "fixed",
          routes: [
            {
              provider: "volcengine",
              providerModel: "kimi-2.5",
              enabled: true,
              weight: 100,
            },
          ],
        },
      ],
    },
  });

  const unauthorizedResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/llm-service/smoke-test",
    headers: {},
  });

  assert.equal(unauthorizedResponse.statusCode, 401);
  assert.equal(unauthorizedResponse.body.code, "ADMIN_BASIC_AUTH_REQUIRED");

  const firstResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/llm-service/smoke-test",
    headers,
  });

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(firstResponse.body.data.summary.totalCount, 1);
  assert.equal(firstResponse.body.data.summary.failureCount, 1);
  assert.equal(firstResponse.body.data.items[0]?.status, "failed");

  const rateLimitedResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/llm-service/smoke-test",
    headers,
  });

  assert.equal(rateLimitedResponse.statusCode, 429);
  assert.equal(rateLimitedResponse.body.code, "ADMIN_RATE_LIMITED");
  assert.match(rateLimitedResponse.body.message, /10 秒内只能触发一次/);
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "admin.llm_service.smoke_test" && item.appId === "common"),
  );
});

test("common workspace does not expose app config API", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/common/config",
    headers,
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, "APP_NOT_FOUND");
});

test("managed app state persists app and config changes through kv backend", async () => {
  const kvBackend = new InMemoryKVBackend();
  const firstRuntime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
    kvBackend,
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  const createResponse = await firstRuntime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps",
    headers,
    body: {
      appId: "app_persisted",
      appName: "Persisted App",
    },
  });

  assert.equal(createResponse.statusCode, 200);

  const configResponse = await firstRuntime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/app_persisted/config",
    headers,
    body: {
      rawJson: '{"mail":{"enabled":true}}',
    },
  });

  assert.equal(configResponse.statusCode, 200);

  const secondRuntime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
    kvBackend,
  });

  const bootstrapResponse = await secondRuntime.app.handle({
    method: "GET",
    path: "/api/v1/admin/bootstrap",
    headers,
  });

  assert.equal(bootstrapResponse.statusCode, 200);
  assert.ok(
    bootstrapResponse.body.data.apps.some((item) => item.appId === "app_persisted"),
  );

  const persistedConfigResponse = await secondRuntime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/app_persisted/config",
    headers,
  });

  assert.equal(persistedConfigResponse.statusCode, 200);
  assert.match(persistedConfigResponse.body.data.rawJson, /"enabled": true/);
});
