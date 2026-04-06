import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { ApplicationError } from "../../src/shared/errors.ts";
import {
  TENCENT_SES_SECRET_ID_PASSWORD_KEY,
  TENCENT_SES_SECRET_KEY_PASSWORD_KEY,
} from "../../src/services/common-email-config.service.ts";
import { type RegistrationEmailSender } from "../../src/services/tencent-ses-registration-email.service.ts";
import { maskSensitiveString } from "../../src/shared/utils.ts";

function createAdminAuthHeader(username = "admin", password = "AdminPass123!"): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function loginAdmin(runtime: Awaited<ReturnType<typeof createApplication>>, username = "admin", password = "AdminPass123!") {
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/auth/login",
    headers: {},
    body: {
      username,
      password,
    },
  });

  assert.equal(response.statusCode, 200);
  const cookie = response.headers?.["Set-Cookie"];
  assert.ok(cookie);
  return cookie;
}

function createEmailServiceRegions() {
  return [
    {
      region: "ap-guangzhou",
      sender: {
        id: "default",
        address: "Admin <noreply@example.com>",
      },
      templates: [
        {
          locale: "zh-CN",
          templateId: 100001,
          name: "verify-code",
          subject: "验证码",
        },
      ],
    },
    {
      region: "ap-hongkong",
      sender: {
        id: "support",
        address: "Support <support@example.com>",
      },
      templates: [
        {
          locale: "en-US",
          templateId: 100002,
          name: "verify-code",
          subject: "Verification Code",
        },
      ],
    },
  ];
}

interface SentTemplateEmail {
  email: string;
  clientRegion: "ap-guangzhou" | "ap-hongkong";
  region: "ap-guangzhou" | "ap-hongkong";
  fromEmailAddress: string;
  subject: string;
  templateId: number;
  templateData: Record<string, unknown>;
}

function createFakeEmailSender(sent: SentTemplateEmail[]): RegistrationEmailSender {
  return {
    async sendTemplateEmail(command) {
      sent.push({
        email: command.email,
        clientRegion: command.clientRegion,
        region: command.region,
        fromEmailAddress: command.fromEmailAddress,
        subject: command.subject,
        templateId: command.templateId,
        templateData: command.templateData,
      });
      return {
        provider: "tencent_ses",
        requestId: "req-test-email",
        messageId: "msg-test-email",
        debug: {
          request: {
            endpoint: "https://ses.tencentcloudapi.com/",
            method: "POST",
            clientRegion: command.clientRegion,
            resolvedRegion: command.region,
            headers: {
              "X-TC-Region": command.region,
            },
            credentials: {
              secretIdMasked: "sid-****",
              secretKeyMasked: "sk-d****",
            },
            body: {
              FromEmailAddress: command.fromEmailAddress,
              Destination: [command.email],
              Subject: command.subject,
              Template: {
                TemplateID: command.templateId,
                TemplateData: JSON.stringify(command.templateData),
              },
            },
          },
          response: {
            statusCode: 200,
            ok: true,
            body: {
              Response: {
                RequestId: "req-test-email",
                MessageId: "msg-test-email",
              },
            },
            requestId: "req-test-email",
            messageId: "msg-test-email",
          },
        },
      };
    },
    async sendVerificationCode() {
      return {
        provider: "tencent_ses",
      };
    },
  };
}

function createFailingEmailSender(): RegistrationEmailSender {
  return {
    async sendTemplateEmail(command) {
      throw new ApplicationError(502, "EMAIL_PROVIDER_REQUEST_FAILED", "FailedOperation.SendEmailErr: region mismatch", {
        requestId: "req-failed-email",
        provider: "tencent_ses",
        debug: {
          request: {
            endpoint: "https://ses.tencentcloudapi.com/",
            method: "POST",
            clientRegion: command.clientRegion,
            resolvedRegion: command.region,
            headers: {
              "X-TC-Region": command.region,
            },
            credentials: {
              secretIdMasked: "sid-****",
              secretKeyMasked: "sk-d****",
            },
            body: {
              FromEmailAddress: command.fromEmailAddress,
              Destination: [command.email],
              Subject: command.subject,
              Template: {
                TemplateID: command.templateId,
                TemplateData: JSON.stringify(command.templateData),
              },
            },
          },
          response: {
            statusCode: 400,
            ok: false,
            body: {
              Response: {
                RequestId: "req-failed-email",
                Error: {
                  Code: "FailedOperation.SendEmailErr",
                  Message: "region mismatch",
                },
              },
            },
            requestId: "req-failed-email",
            errorCode: "FailedOperation.SendEmailErr",
            errorMessage: "region mismatch",
          },
        },
      });
    },
    async sendVerificationCode() {
      return {
        provider: "tencent_ses",
      };
    },
  };
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
  assert.match(String(bootstrapResponse.body.data.apps[0]?.logSecret.keyId), /^logk_/);
  assert.match(String(bootstrapResponse.body.data.apps[0]?.logSecret.secretMasked), /\*/);

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

test("public app config API exposes admin delivery config for the requested app", async () => {
  const runtime = await createApplication();

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/app_a/public/config",
    headers: {
      "x-app-id": "app_a",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.appId, "app_a");
  assert.deepEqual(response.body.data.config, {
    release: {
      version: "2026.03.20",
      channel: "stable",
    },
    featureFlags: {
      showOnboarding: true,
      enableVipBanner: false,
    },
    settings: {
      theme: "spring",
      apiBasePath: "/api/v1",
    },
  });
});

test("public app config API rejects X-App-Id mismatches against the path app", async () => {
  const runtime = await createApplication();

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/app_a/public/config",
    headers: {
      "x-app-id": "app_b",
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "AUTH_APP_SCOPE_MISMATCH");
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

  const storedValue = await runtime.services.appConfigService.getValue("app_b", "admin.delivery_config");
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
  assert.equal(unauthorizedResponse.body.code, "ADMIN_AUTH_REQUIRED");

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

test("admin auth login creates a persistent session cookie backed by Redis KV", async () => {
  const firstRuntime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });

  const cookie = await loginAdmin(firstRuntime);
  assert.match(cookie, /adminSession=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Max-Age=1209600/);

  const secondRuntime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
    kvManager: firstRuntime.services.kvManager,
  });

  const bootstrapResponse = await secondRuntime.app.handle({
    method: "GET",
    path: "/api/v1/admin/bootstrap",
    headers: {
      cookie,
    },
  });

  assert.equal(bootstrapResponse.statusCode, 200);
  assert.equal(bootstrapResponse.body.data.adminUser, "admin");
  assert.match(String(bootstrapResponse.body.data.sessionExpiresAt), /^20/);
});

test("admin auth logout clears the session cookie and invalidates the admin session", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });

  const cookie = await loginAdmin(runtime);
  const logoutResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/auth/logout",
    headers: {
      cookie,
    },
  });

  assert.equal(logoutResponse.statusCode, 200);
  assert.match(String(logoutResponse.headers?.["Set-Cookie"] ?? ""), /Max-Age=0/);

  const bootstrapResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/bootstrap",
    headers: {
      cookie,
    },
  });

  assert.equal(bootstrapResponse.statusCode, 401);
  assert.equal(bootstrapResponse.body.code, "ADMIN_AUTH_REQUIRED");
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
      appNameZhCn: "应用 C",
      appNameEnUs: "App C",
    },
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.body.data.appId, "app_c");
  assert.equal(createResponse.body.data.appName, "应用 C");
  assert.deepEqual(createResponse.body.data.appNameI18n, {
    "zh-CN": "应用 C",
    "en-US": "App C",
  });
  assert.equal(createResponse.body.data.canDelete, false);
  assert.match(String(createResponse.body.data.logSecret.keyId), /^logk_/);
  assert.match(String(createResponse.body.data.logSecret.secretMasked), /\*/);
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "admin.app.create" && item.appId === "app_c"),
  );

  const createdConfigResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/app_c/config",
    headers,
  });

  assert.equal(createdConfigResponse.statusCode, 200);
  assert.equal(
    createdConfigResponse.body.data.rawJson,
    JSON.stringify(
      {
        app: "make_app_c_great_again",
      },
      null,
      2,
    ),
  );

  const blockedDeleteResponse = await runtime.app.handle({
    method: "DELETE",
    path: "/api/v1/admin/apps/app_c",
    headers,
  });

  assert.equal(blockedDeleteResponse.statusCode, 409);
  assert.equal(blockedDeleteResponse.body.code, "ADMIN_APP_DELETE_REQUIRES_EMPTY_CONFIG");

  const clearConfigResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/app_c/config",
    headers,
    body: {
      rawJson: "{}",
      desc: "clear before delete",
    },
  });

  assert.equal(clearConfigResponse.statusCode, 200);

  const stillBlockedDeleteResponse = await runtime.app.handle({
    method: "DELETE",
    path: "/api/v1/admin/apps/app_a",
    headers,
  });

  assert.equal(stillBlockedDeleteResponse.statusCode, 409);
  assert.equal(stillBlockedDeleteResponse.body.code, "ADMIN_APP_DELETE_REQUIRES_EMPTY_CONFIG");

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

test("admin app create rejects app ids outside lowercase letters numbers and underscores", async () => {
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
    method: "POST",
    path: "/api/v1/admin/apps",
    headers,
    body: {
      appId: "App-Test",
      appNameZhCn: "应用测试",
      appNameEnUs: "App Test",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "REQ_INVALID_BODY");
  assert.match(String(response.body.message), /lowercase letters, numbers, and underscores/);
});

test("admin app config reads and delete guards follow latest revision even if direct config record is stale", async () => {
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
    method: "POST",
    path: "/api/v1/admin/apps",
    headers,
    body: {
      appId: "app_c",
      appNameZhCn: "应用 C",
      appNameEnUs: "App C",
    },
  });

  await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/app_c/config",
    headers,
    body: {
      rawJson: "{}",
      desc: "clear before delete",
    },
  });

  const staleRecord = runtime.database.appConfigs.find(
    (item) => item.appId === "app_c" && item.configKey === "admin.delivery_config",
  );
  assert.ok(staleRecord);
  staleRecord.configValue = '{"stale":true}';
  staleRecord.updatedAt = "2026-04-03T10:00:00.000Z";

  const bootstrapResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/bootstrap",
    headers,
  });

  assert.equal(bootstrapResponse.statusCode, 200);
  const appSummary = bootstrapResponse.body.data.apps.find((item: { appId: string }) => item.appId === "app_c");
  assert.equal(appSummary?.canDelete, true);

  const configResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/app_c/config",
    headers,
  });

  assert.equal(configResponse.statusCode, 200);
  assert.equal(configResponse.body.data.rawJson, "{}");

  const deleteResponse = await runtime.app.handle({
    method: "DELETE",
    path: "/api/v1/admin/apps/app_c",
    headers,
  });

  assert.equal(deleteResponse.statusCode, 200);
  assert.equal(deleteResponse.body.data.deleted, true);
});

test("admin app APIs can update localized app names and add extra locales", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  const updateResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/app_a/names",
    headers,
    body: {
      appNameI18n: {
        "zh-CN": "小说工坊",
        "en-US": "Novel Forge",
        "ja-JP": "ノベル工房",
      },
    },
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.body.data.appId, "app_a");
  assert.equal(updateResponse.body.data.appName, "小说工坊");
  assert.deepEqual(updateResponse.body.data.appNameI18n, {
    "zh-CN": "小说工坊",
    "en-US": "Novel Forge",
    "ja-JP": "ノベル工房",
  });
  assert.equal(runtime.database.findApp("app_a")?.name, "Novel Forge");
  assert.deepEqual(runtime.database.findApp("app_a")?.nameI18n, {
    "zh-CN": "小说工坊",
    "en-US": "Novel Forge",
    "ja-JP": "ノベル工房",
  });
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "admin.app.update_names" && item.appId === "app_a"),
  );

  const bootstrapResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/bootstrap",
    headers,
  });

  assert.equal(bootstrapResponse.statusCode, 200);
  const updatedApp = bootstrapResponse.body.data.apps.find((item: { appId: string }) => item.appId === "app_a");
  assert.equal(updatedApp?.appName, "小说工坊");
  assert.equal(updatedApp?.appNameI18n?.["ja-JP"], "ノベル工房");
});

test("admin app name updates require both zh-CN and en-US", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });

  const response = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/app_a/names",
    headers: {
      authorization: createAdminAuthHeader(),
    },
    body: {
      appNameI18n: {
        "zh-CN": "小说工坊",
      },
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "REQ_INVALID_BODY");
  assert.match(String(response.body.message), /appNameI18n\.en-US/);
});

test("admin remote log pull settings API exposes defaults, updates revisions, and restores older versions", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  const defaultResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/app_a/remote-log-pull",
    headers,
  });

  assert.equal(defaultResponse.statusCode, 200);
  assert.equal(defaultResponse.body.data.configKey, "remote_log_pull.settings");
  assert.deepEqual(defaultResponse.body.data.config, {
    enabled: false,
    minPullIntervalSeconds: 1800,
    claimTtlSeconds: 300,
    taskDefaults: {
      lookbackMinutes: 60,
      maxLines: 2000,
      maxBytes: 1048576,
    },
  });

  const updateResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/app_a/remote-log-pull",
    headers,
    body: {
      config: {
        enabled: true,
        minPullIntervalSeconds: 120,
        claimTtlSeconds: 90,
        taskDefaults: {
          lookbackMinutes: 30,
          maxLines: 300,
          maxBytes: 65536,
        },
      },
      desc: "incident tuning",
    },
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.body.data.revision, 2);
  assert.equal(updateResponse.body.data.desc, "incident tuning");
  assert.equal(updateResponse.body.data.config.enabled, true);
  assert.equal(updateResponse.body.data.config.taskDefaults.lookbackMinutes, 30);

  const restoreResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/app_a/remote-log-pull/revisions/1/restore",
    headers,
  });

  assert.equal(restoreResponse.statusCode, 200);
  assert.equal(restoreResponse.body.data.config.enabled, false);
  assert.equal(restoreResponse.body.data.revision, 3);
});

test("admin remote log pull task API creates tasks from defaults and can cancel them", async () => {
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
    path: "/api/v1/admin/apps/app_a/remote-log-pull",
    headers,
    body: {
      config: {
        enabled: true,
        minPullIntervalSeconds: 120,
        claimTtlSeconds: 180,
        taskDefaults: {
          lookbackMinutes: 15,
          maxLines: 500,
          maxBytes: 32768,
        },
      },
    },
  });

  const createResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/app_a/remote-log-pull/tasks",
    headers,
    body: {
      userId: "user_alice",
      clientId: "did_ios_001",
    },
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.body.data.items.length, 1);
  assert.equal(createResponse.body.data.items[0]?.userId, "user_alice");
  assert.equal(createResponse.body.data.items[0]?.clientId, "did_ios_001");
  assert.equal(createResponse.body.data.items[0]?.maxLines, 500);
  assert.equal(createResponse.body.data.items[0]?.maxBytes, 32768);
  assert.equal(createResponse.body.data.items[0]?.keyId.startsWith("logk_"), true);
  assert.equal(createResponse.body.data.items[0]?.status, "PENDING");

  const taskId = createResponse.body.data.items[0]?.taskId;
  assert.ok(taskId);

  const cancelResponse = await runtime.app.handle({
    method: "POST",
    path: `/api/v1/admin/apps/app_a/remote-log-pull/tasks/${taskId}/cancel`,
    headers,
  });

  assert.equal(cancelResponse.statusCode, 200);
  assert.equal(
    cancelResponse.body.data.items.find((item: { taskId: string }) => item.taskId === taskId)?.status,
    "CANCELLED",
  );
});

test("admin app log secret reveal requires sensitive verification and grants 1h access after email code", async () => {
  const sentVerificationEmails: SentVerificationEmail[] = [];
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
    adminSensitiveOperation: {
      secondaryPassword: "199510",
    },
  });

  const cookie = await loginAdmin(runtime);

  const directRevealResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/app_a/log-secret/reveal",
    headers: {
      cookie,
    },
  });

  assert.equal(directRevealResponse.statusCode, 403);
  assert.equal(directRevealResponse.body.code, "ADMIN_SENSITIVE_OPERATION_REQUIRED");

  const requestCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/sensitive-operations/request-code",
    headers: {
      cookie,
    },
    body: {
      operation: "app.log_secret.read",
    },
  });

  assert.equal(requestCodeResponse.statusCode, 200);
  assert.equal(requestCodeResponse.body.data.operation, "app.log_secret.read");

  const verifyResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/sensitive-operations/verify",
    headers: {
      cookie,
    },
    body: {
      operation: "app.log_secret.read",
      code: "199510",
    },
  });

  assert.equal(verifyResponse.statusCode, 200);
  assert.equal(verifyResponse.body.data.granted, true);
  assert.match(String(verifyResponse.body.data.expiresAt), /^20/);

  const revealResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/app_a/log-secret/reveal",
    headers: {
      cookie,
    },
  });

  assert.equal(revealResponse.statusCode, 200);
  assert.equal(revealResponse.body.data.app.appId, "app_a");
  assert.equal(revealResponse.body.data.keyId, (await runtime.services.appLogSecretService.getSummary("app_a"))?.keyId);
  assert.equal(revealResponse.body.data.secret.length > 20, true);
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "admin.app.log_secret.reveal" && item.appId === "app_a"),
  );
});

test("admin password API stores masked common secrets without revision history", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  const updateResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/passwords",
    headers,
    body: {
      items: [
        {
          key: TENCENT_SES_SECRET_ID_PASSWORD_KEY,
          desc: "腾讯 SES SecretId",
          value: "sid-demo",
        },
      ],
    },
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.body.data.configKey, "common.passwords");
  assert.equal(updateResponse.body.data.items[0]?.value, "sid-****");
  assert.equal(updateResponse.body.data.items[0]?.valueMd5, "b4d7390125134c3b8485c802e1efe692");

  const fetchResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/common/passwords",
    headers,
  });

  assert.equal(fetchResponse.statusCode, 200);
  assert.equal(fetchResponse.body.data.items[0]?.desc, "腾讯 SES SecretId");
  assert.equal(fetchResponse.body.data.items[0]?.value, "sid-****");
  assert.equal(fetchResponse.body.data.items[0]?.valueMd5, "b4d7390125134c3b8485c802e1efe692");
  assert.equal(await runtime.services.commonPasswordConfigService.getValue(TENCENT_SES_SECRET_ID_PASSWORD_KEY), "sid-demo");
});

test("admin password API supports per-item upsert and delete", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  const upsertResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/passwords/item",
    headers,
    body: {
      key: "bailian.api_key",
      desc: "百炼 API Key",
      value: "key-v1",
    },
  });

  assert.equal(upsertResponse.statusCode, 200);
  assert.equal(upsertResponse.body.data.items[0]?.key, "bailian.api_key");
  assert.equal(await runtime.services.commonPasswordConfigService.getValue("bailian.api_key"), "key-v1");

  const maskedReplayResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/passwords/item",
    headers,
    body: {
      originalKey: "bailian.api_key",
      key: "bailian.api_key",
      desc: "百炼 API Key",
      value: upsertResponse.body.data.items[0]?.value,
    },
  });

  assert.equal(maskedReplayResponse.statusCode, 200);
  assert.equal(await runtime.services.commonPasswordConfigService.getValue("bailian.api_key"), "key-v1");

  const renameResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/passwords/item",
    headers,
    body: {
      originalKey: "bailian.api_key",
      key: "bailian.runtime_api_key",
      desc: "百炼运行时 API Key",
      value: "key-v2",
    },
  });

  assert.equal(renameResponse.statusCode, 400);
  assert.equal(renameResponse.body.code, "ADMIN_PASSWORD_INVALID");
  assert.equal(await runtime.services.commonPasswordConfigService.getValue("bailian.api_key"), "key-v1");
  assert.equal(await runtime.services.commonPasswordConfigService.getValue("bailian.runtime_api_key"), undefined);

  const updateResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/passwords/item",
    headers,
    body: {
      originalKey: "bailian.api_key",
      key: "bailian.api_key",
      desc: "百炼 API Key",
      value: "key-v2",
    },
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(await runtime.services.commonPasswordConfigService.getValue("bailian.api_key"), "key-v2");

  const deleteResponse = await runtime.app.handle({
    method: "DELETE",
    path: "/api/v1/admin/apps/common/passwords/bailian.api_key",
    headers,
  });

  assert.equal(deleteResponse.statusCode, 200);
  assert.equal(deleteResponse.body.data.items.length, 0);
});

test("admin password reveal requires sensitive verification before copying real value", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
    adminSensitiveOperation: {
      secondaryPassword: "199510",
    },
  });

  await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/passwords/item",
    headers: {
      authorization: createAdminAuthHeader(),
    },
    body: {
      key: "bailian.api_key",
      desc: "百炼 API Key",
      value: "key-v1",
    },
  });

  const cookie = await loginAdmin(runtime);

  const directRevealResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/passwords/bailian.api_key/reveal",
    headers: {
      cookie,
    },
  });

  assert.equal(directRevealResponse.statusCode, 403);
  assert.equal(directRevealResponse.body.code, "ADMIN_SENSITIVE_OPERATION_REQUIRED");

  const requestCodeResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/sensitive-operations/request-code",
    headers: {
      cookie,
    },
    body: {
      operation: "password.value.read",
    },
  });

  assert.equal(requestCodeResponse.statusCode, 200);
  assert.equal(requestCodeResponse.body.data.operation, "password.value.read");

  const verifyResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/sensitive-operations/verify",
    headers: {
      cookie,
    },
    body: {
      operation: "password.value.read",
      code: "199510",
    },
  });

  assert.equal(verifyResponse.statusCode, 200);
  assert.equal(verifyResponse.body.data.granted, true);

  const revealResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/passwords/bailian.api_key/reveal",
    headers: {
      cookie,
    },
  });

  assert.equal(revealResponse.statusCode, 200);
  assert.equal(revealResponse.body.data.key, "bailian.api_key");
  assert.equal(revealResponse.body.data.value, "key-v1");
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "admin.password.reveal" && item.appId === "common"),
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

  const passwordResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/passwords",
    headers,
    body: {
      items: [
        {
          key: TENCENT_SES_SECRET_ID_PASSWORD_KEY,
          desc: "腾讯 SES SecretId",
          value: "sid-demo",
        },
        {
          key: TENCENT_SES_SECRET_KEY_PASSWORD_KEY,
          desc: "腾讯 SES SecretKey",
          value: "sk-demo",
        },
      ],
    },
  });

  assert.equal(passwordResponse.statusCode, 200);
  assert.equal(passwordResponse.body.data.items[0]?.value, maskSensitiveString("sid-demo"));
  assert.equal(passwordResponse.body.data.items[1]?.value, maskSensitiveString("sk-demo"));
  assert.equal(passwordResponse.body.data.items[0]?.valueMd5, "b4d7390125134c3b8485c802e1efe692");
  assert.equal(passwordResponse.body.data.items[1]?.valueMd5, "663d6ce05d17561635f0ffe690a0cb75");

  const updateResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/email-service",
    headers,
    body: {
      enabled: true,
      desc: "初始化邮件服务",
      regions: createEmailServiceRegions(),
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
  assert.equal(updateResponse.body.data.config.regions[0]?.region, "ap-guangzhou");
  assert.equal(updateResponse.body.data.config.regions[0]?.sender?.id, "default");
  assert.equal(updateResponse.body.data.config.regions[1]?.sender?.address, "Support <support@example.com>");
  assert.equal(updateResponse.body.data.config.regions[0]?.templates[0]?.templateId, 100001);
  assert.equal(updateResponse.body.data.config.regions[1]?.templates[0]?.locale, "en-US");
  assert.equal(updateResponse.body.data.config.regions[1]?.templates[0]?.name, "verify-code");
  assert.equal(updateResponse.body.data.config.regions[1]?.templates[0]?.subject, "Verification Code");

  const fetchResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/common/email-service",
    headers,
  });

  assert.equal(fetchResponse.statusCode, 200);
  assert.equal(fetchResponse.body.data.config.regions.length, 2);
  assert.equal((await runtime.services.commonEmailConfigService.getRuntimeConfig()).secretId, "sid-demo");
  assert.equal((await runtime.services.commonEmailConfigService.getRuntimeConfig()).secretKey, "sk-demo");

  const maskedUpdateResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/passwords",
    headers,
    body: {
      items: [
        {
          key: TENCENT_SES_SECRET_ID_PASSWORD_KEY,
          desc: "腾讯 SES SecretId",
          value: "sid-****",
        },
        {
          key: TENCENT_SES_SECRET_KEY_PASSWORD_KEY,
          desc: "腾讯 SES SecretKey",
          value: maskSensitiveString("sk-demo"),
        },
      ],
    },
  });

  assert.equal(maskedUpdateResponse.statusCode, 200);
  assert.equal(maskedUpdateResponse.body.data.items[0]?.value, "sid-****");
  assert.equal((await runtime.services.commonPasswordConfigService.getValue(TENCENT_SES_SECRET_ID_PASSWORD_KEY)), "sid-demo");
  assert.equal((await runtime.services.commonPasswordConfigService.getValue(TENCENT_SES_SECRET_KEY_PASSWORD_KEY)), "sk-demo");

  const templateUpdateResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/email-service",
    headers,
    body: {
      ...fetchResponse.body.data.config,
      desc: "补充中文模板",
      regions: fetchResponse.body.data.config.regions.map((region) => (
        region.region === "ap-guangzhou"
          ? {
              ...region,
              templates: [
                ...region.templates,
                {
                  locale: "zh",
                  templateId: 100003,
                  name: "验证码简体",
                  subject: "验证码（简体）",
                },
              ],
            }
          : region
      )),
    },
  });

  assert.equal(templateUpdateResponse.statusCode, 200);
  assert.equal(templateUpdateResponse.body.data.revision, 2);
  assert.equal(templateUpdateResponse.body.data.desc, "补充中文模板");
  assert.deepEqual(
    templateUpdateResponse.body.data.revisions.map((item) => item.revision),
    [2, 1],
  );
  assert.equal((await runtime.services.commonEmailConfigService.getRuntimeConfig()).secretId, "sid-demo");
  assert.equal((await runtime.services.commonEmailConfigService.getRuntimeConfig()).secretKey, "sk-demo");
  assert.equal(
    (await runtime.services.commonEmailConfigService.getRuntimeConfig("en-US", "ap-hongkong")).sender.address,
    "Support <support@example.com>",
  );
  assert.equal((await runtime.services.commonEmailConfigService.getRuntimeConfig("en-US", "ap-hongkong")).template.name, "verify-code");
  assert.equal((await runtime.services.commonEmailConfigService.getRuntimeConfig("en-US", "ap-hongkong")).template.templateId, 100002);
  assert.equal((await runtime.services.commonEmailConfigService.getRuntimeConfig("zh-TW")).template.templateId, 100003);
  await assert.rejects(
    runtime.services.commonEmailConfigService.getRuntimeConfig("en-US", "ap-hongkong", "missing-template"),
    (error: unknown) => (
      error instanceof ApplicationError
      && error.statusCode === 503
      && error.code === "EMAIL_SERVICE_NOT_CONFIGURED"
      && /missing-template/.test(error.message)
    ),
  );

  await runtime.services.commonEmailConfigService.updateConfig({
    enabled: true,
    regions: [
      {
        region: "ap-guangzhou",
        sender: {
          id: "default",
          address: "Admin <noreply@example.com>",
        },
        templates: [
          {
            locale: "zh-CN",
            templateId: 100101,
            name: "verify-code",
            subject: "验证码",
          },
        ],
      },
      {
        region: "ap-hongkong",
        sender: {
          id: "support",
          address: "Support <support@example.com>",
        },
        templates: [
          {
            locale: "en-US",
            templateId: 100102,
            name: "verify-code",
            subject: "Verification Code",
          },
          {
            locale: "en-US",
            templateId: 100103,
            name: "欢迎邮件",
            subject: "Welcome",
          },
        ],
      },
    ],
  });

  const verificationRuntime = await runtime.services.commonEmailConfigService.getRuntimeConfig("en-US", "ap-hongkong", "verify-code");
  assert.equal(verificationRuntime.template.templateId, 100102);
  assert.equal(verificationRuntime.template.name, "verify-code");

  const revisionOneResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/common/email-service/revisions/1",
    headers,
  });

  assert.equal(revisionOneResponse.statusCode, 200);
  assert.equal(revisionOneResponse.body.data.revision, 1);
  assert.equal(revisionOneResponse.body.data.isLatest, false);
  assert.equal(revisionOneResponse.body.data.config.regions[0]?.templates.length, 1);
  assert.equal(revisionOneResponse.body.data.config.regions[1]?.templates.length, 1);

  const restoreResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/email-service/revisions/1/restore",
    headers,
  });

  assert.equal(restoreResponse.statusCode, 200);
  assert.equal(restoreResponse.body.data.revision, 4);
  assert.equal(restoreResponse.body.data.isLatest, true);
  assert.equal(restoreResponse.body.data.desc, "恢复到版本 R1");
  assert.equal(restoreResponse.body.data.config.regions[0]?.templates.length, 1);
  assert.equal(restoreResponse.body.data.config.regions[1]?.templates.length, 1);
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "admin.email_service.update" && item.appId === "common"),
  );
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "admin.email_service.restore" && item.appId === "common"),
  );
});

test("common email service runtime follows latest revision even if direct config record is stale", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });

  await runtime.services.commonEmailConfigService.updateConfig({
    enabled: true,
    regions: createEmailServiceRegions(),
  });
  await runtime.services.commonPasswordConfigService.set(TENCENT_SES_SECRET_ID_PASSWORD_KEY, "腾讯 SES SecretId", "sid-demo");
  await runtime.services.commonPasswordConfigService.set(TENCENT_SES_SECRET_KEY_PASSWORD_KEY, "腾讯 SES SecretKey", "sk-demo");

  const staleEmailRecord = runtime.database.appConfigs.find(
    (item) => item.appId === "common" && item.configKey === "common.email_service_regions",
  );
  assert.ok(staleEmailRecord);
  staleEmailRecord.configValue = JSON.stringify({
    enabled: false,
    regions: createEmailServiceRegions(),
  });

  const document = await runtime.services.commonEmailConfigService.getDocument();
  assert.equal(document.config.enabled, true);
  assert.equal(document.revision, 1);

  const runtimeConfig = await runtime.services.commonEmailConfigService.getRuntimeConfigByTemplateId(100001, "ap-guangzhou");
  assert.equal(runtimeConfig.config.enabled, true);
  assert.equal(runtimeConfig.template.templateId, 100001);
  assert.equal(runtimeConfig.secretId, "sid-demo");
  assert.equal(runtimeConfig.secretKey, "sk-demo");
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
      regions: [
        {
          region: "ap-guangzhou",
          sender: {
            id: "default",
            address: "not-an-email",
          },
          templates: [
            {
              locale: "zh-CN",
              templateId: 100001,
              name: "verify-code",
              subject: "验证码",
            },
          ],
        },
      ],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "ADMIN_EMAIL_SERVICE_INVALID");
  assert.match(response.body.message, /Sender address format is invalid/);
});

test("admin email service API rejects duplicate email region, duplicate template keys and missing subject", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  const duplicateRegionResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/email-service",
    headers,
    body: {
      enabled: true,
      regions: [
        {
          region: "ap-guangzhou",
          sender: {
            id: "cn",
            address: "Admin <noreply@example.com>",
          },
          templates: [
            {
              locale: "zh-CN",
              templateId: 100001,
              name: "verify-code",
              subject: "验证码",
            },
          ],
        },
        {
          region: "ap-guangzhou",
          sender: {
            id: "cn-backup",
            address: "Backup <backup@example.com>",
          },
          templates: [],
        },
      ],
    },
  });

  assert.equal(duplicateRegionResponse.statusCode, 400);
  assert.equal(duplicateRegionResponse.body.code, "ADMIN_EMAIL_SERVICE_INVALID");
  assert.match(duplicateRegionResponse.body.message, /Duplicate email region/);

  const duplicateTemplateKeyResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/email-service",
    headers,
    body: {
      enabled: true,
      regions: [
        {
          region: "ap-guangzhou",
          sender: {
            id: "default",
            address: "Admin <noreply@example.com>",
          },
          templates: [
            {
              locale: "zh-CN",
              templateId: 100001,
              name: "verify-code",
              subject: "验证码",
            },
            {
              locale: "zh-CN",
              templateId: 100003,
              name: "verify-code",
              subject: "验证码（备用）",
            },
          ],
        },
      ],
    },
  });

  assert.equal(duplicateTemplateKeyResponse.statusCode, 400);
  assert.equal(duplicateTemplateKeyResponse.body.code, "ADMIN_EMAIL_SERVICE_INVALID");
  assert.match(duplicateTemplateKeyResponse.body.message, /Duplicate template name \+ locale/);

  const duplicateTemplateIdResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/email-service",
    headers,
    body: {
      enabled: true,
      regions: [
        {
          region: "ap-guangzhou",
          sender: {
            id: "default",
            address: "Admin <noreply@example.com>",
          },
          templates: [
            {
              locale: "zh-CN",
              templateId: 100001,
              name: "verify-code",
              subject: "验证码",
            },
          ],
        },
        {
          region: "ap-hongkong",
          sender: {
            id: "global",
            address: "Global <global@example.com>",
          },
          templates: [
            {
              locale: "en-US",
              templateId: 100001,
              name: "verify-code",
              subject: "Verification Code",
            },
          ],
        },
      ],
    },
  });

  assert.equal(duplicateTemplateIdResponse.statusCode, 400);
  assert.equal(duplicateTemplateIdResponse.body.code, "ADMIN_EMAIL_SERVICE_INVALID");
  assert.match(duplicateTemplateIdResponse.body.message, /Duplicate template ID/);

  const missingSubjectResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/email-service",
    headers,
    body: {
      enabled: true,
      regions: [
        {
          region: "ap-guangzhou",
          sender: {
            id: "default",
            address: "Admin <noreply@example.com>",
          },
          templates: [
            {
              locale: "en-US",
              templateId: 100002,
              name: "verify-code",
              subject: "",
            },
          ],
        },
      ],
    },
  });

  assert.equal(missingSubjectResponse.statusCode, 400);
  assert.equal(missingSubjectResponse.body.code, "ADMIN_EMAIL_SERVICE_INVALID");
  assert.match(missingSubjectResponse.body.message, /Template subject is required/);

  const missingVerificationTemplateResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/email-service",
    headers,
    body: {
      enabled: true,
      regions: [
        {
          region: "ap-hongkong",
          sender: {
            id: "global",
            address: "Global <global@example.com>",
          },
          templates: [
            {
              locale: "en-US",
              templateId: 100005,
              name: "welcome-email",
              subject: "Welcome",
            },
          ],
        },
      ],
    },
  });

  assert.equal(missingVerificationTemplateResponse.statusCode, 400);
  assert.equal(missingVerificationTemplateResponse.body.code, "ADMIN_EMAIL_SERVICE_INVALID");
  assert.match(missingVerificationTemplateResponse.body.message, /verify-code/);
});

test("admin email service test-send API requires super-admin auth and enforces 20 second cooldown", async () => {
  const sent: SentTemplateEmail[] = [];
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
    registrationEmailSender: createFakeEmailSender(sent),
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/passwords",
    headers,
    body: {
      items: [
        {
          key: TENCENT_SES_SECRET_ID_PASSWORD_KEY,
          desc: "腾讯 SES SecretId",
          value: "sid-demo",
        },
        {
          key: TENCENT_SES_SECRET_KEY_PASSWORD_KEY,
          desc: "腾讯 SES SecretKey",
          value: "sk-demo",
        },
      ],
    },
  });

  await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/email-service",
    headers,
    body: {
      enabled: true,
      regions: [
        {
          region: "ap-guangzhou",
          sender: {
            id: "mainland",
            address: "Admin <noreply@example.com>",
          },
          templates: [
            {
              locale: "zh-CN",
              templateId: 100001,
              name: "verify-code",
              subject: "验证码",
            },
          ],
        },
        {
          region: "ap-hongkong",
          sender: {
            id: "global",
            address: "Global <global@example.com>",
          },
          templates: [
            {
              locale: "en-US",
              templateId: 100002,
              name: "verify-code",
              subject: "Verification Code",
            },
          ],
        },
      ],
    },
  });

  const unauthorizedResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/email-service/test-send",
    headers: {},
    body: {
      recipientEmail: "tester@example.com",
      region: "ap-hongkong",
      templateId: 100002,
      appName: "Zook",
      code: "654321",
      expireMinutes: 10,
    },
  });

  assert.equal(unauthorizedResponse.statusCode, 401);
  assert.equal(unauthorizedResponse.body.code, "ADMIN_AUTH_REQUIRED");

  const firstResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/email-service/test-send",
    headers,
    body: {
      recipientEmail: "tester@example.com",
      region: "ap-hongkong",
      templateId: 100002,
      appName: "Zook",
      code: "654321",
      expireMinutes: 10,
    },
  });

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(firstResponse.body.data.recipientEmail, "tester@example.com");
  assert.equal(firstResponse.body.data.clientRegion, "ap-hongkong");
  assert.equal(firstResponse.body.data.resolvedRegion, "ap-hongkong");
  assert.equal(firstResponse.body.data.sender.address, "Global <global@example.com>");
  assert.equal(firstResponse.body.data.template.templateId, 100002);
  assert.equal(firstResponse.body.data.providerRequestId, "req-test-email");
  assert.equal(firstResponse.body.data.providerMessageId, "msg-test-email");
  assert.equal(firstResponse.body.data.debug.request.clientRegion, "ap-hongkong");
  assert.equal(firstResponse.body.data.debug.request.resolvedRegion, "ap-hongkong");
  assert.equal(firstResponse.body.data.debug.request.credentials.secretIdMasked, "sid-****");
  assert.equal(firstResponse.body.data.debug.response.requestId, "req-test-email");
  assert.deepEqual(sent, [
    {
      email: "tester@example.com",
      clientRegion: "ap-hongkong",
      region: "ap-hongkong",
      fromEmailAddress: "Global <global@example.com>",
      subject: "Verification Code",
      templateId: 100002,
      templateData: {
        appName: "Zook",
        expireMinutes: 10,
        code: "654321",
      },
    },
  ]);

  const rateLimitedResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/email-service/test-send",
    headers,
    body: {
      recipientEmail: "tester@example.com",
      region: "ap-hongkong",
      templateId: 100002,
      appName: "Zook",
      code: "654321",
      expireMinutes: 10,
    },
  });

  assert.equal(rateLimitedResponse.statusCode, 429);
  assert.equal(rateLimitedResponse.body.code, "ADMIN_RATE_LIMITED");
  assert.ok(
    runtime.database.auditLogs.some((item) => item.action === "admin.email_service.test_send" && item.appId === "common"),
  );
});

test("admin email service test-send API returns masked provider debug details on failure", async () => {
  const runtime = await createApplication({
    adminBasicAuth: {
      username: "admin",
      password: "AdminPass123!",
    },
    registrationEmailSender: createFailingEmailSender(),
  });
  const headers = {
    authorization: createAdminAuthHeader(),
  };

  await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/passwords",
    headers,
    body: {
      items: [
        {
          key: TENCENT_SES_SECRET_ID_PASSWORD_KEY,
          desc: "腾讯 SES SecretId",
          value: "sid-demo",
        },
        {
          key: TENCENT_SES_SECRET_KEY_PASSWORD_KEY,
          desc: "腾讯 SES SecretKey",
          value: "sk-demo",
        },
      ],
    },
  });

  await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/email-service",
    headers,
    body: {
      enabled: true,
      regions: [
        {
          region: "ap-guangzhou",
          sender: {
            id: "mainland",
            address: "Admin <noreply@example.com>",
          },
          templates: [
            {
              locale: "zh-CN",
              templateId: 100001,
              name: "verify-code",
              subject: "验证码",
            },
          ],
        },
      ],
    },
  });

  const failedResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/email-service/test-send",
    headers,
    body: {
      recipientEmail: "tester@example.com",
      region: "ap-guangzhou",
      templateId: 100001,
      appName: "Zook",
      code: "654321",
      expireMinutes: 10,
    },
  });

  assert.equal(failedResponse.statusCode, 502);
  assert.equal(failedResponse.body.code, "EMAIL_PROVIDER_REQUEST_FAILED");
  assert.equal(failedResponse.body.data.provider, "tencent_ses");
  assert.equal(failedResponse.body.data.requestId, "req-failed-email");
  assert.equal(failedResponse.body.data.debug.request.clientRegion, "ap-guangzhou");
  assert.equal(failedResponse.body.data.debug.request.resolvedRegion, "ap-guangzhou");
  assert.equal(failedResponse.body.data.debug.request.credentials.secretIdMasked, "sid-****");
  assert.equal(failedResponse.body.data.debug.request.credentials.secretKeyMasked, "sk-d****");
  assert.equal(failedResponse.body.data.debug.response.errorCode, "FailedOperation.SendEmailErr");
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
  assert.equal(updateResponse.body.data.config.providers[0]?.apiKey, maskSensitiveString("mock-bailian-api-key"));
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

test("admin llm service keeps password references visible in config and resolves them at runtime", async () => {
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
    path: "/api/v1/admin/apps/common/passwords",
    headers,
    body: {
      items: [
        {
          key: "bailian.api_key",
          desc: "百炼 API Key",
          value: "resolved-bailian-key",
        },
      ],
    },
  });

  const updateResponse = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/admin/apps/common/llm-service",
    headers,
    body: {
      enabled: true,
      defaultModelKey: "kimi2.5",
      providers: [
        {
          key: "bailian",
          label: "阿里云百炼",
          enabled: true,
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          apiKey: "{{zook.ps.bailian.api_key}}",
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
              provider: "bailian",
              providerModel: "kimi/kimi-k2.5",
              enabled: true,
              weight: 100,
            },
          ],
        },
      ],
    },
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.body.data.config.providers[0]?.apiKey, "{{zook.ps.bailian.api_key}}");

  const runtimeConfig = await runtime.services.commonLlmConfigService.getRuntimeConfig();
  assert.equal(runtimeConfig?.providers[0]?.apiKey, "resolved-bailian-key");
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
  assert.equal(unauthorizedResponse.body.code, "ADMIN_AUTH_REQUIRED");

  const firstResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/admin/apps/common/llm-service/smoke-test",
    headers,
  });

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(firstResponse.body.data.summary.totalCount, 1);
  assert.equal(firstResponse.body.data.summary.failureCount, 1);
  assert.equal(firstResponse.body.data.items[0]?.status, "failed");
  assert.equal(firstResponse.body.data.items[0]?.details.request?.provider, "volcengine");
  assert.equal(firstResponse.body.data.items[0]?.details.request?.providerModel, "kimi-2.5");
  assert.equal(firstResponse.body.data.items[0]?.details.error?.code, "LLM_ROUTE_NOT_AVAILABLE");

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
      appNameZhCn: "持久化应用",
      appNameEnUs: "Persisted App",
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
