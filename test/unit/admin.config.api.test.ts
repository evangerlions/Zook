import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";

function createAdminAuthHeader(username = "admin", password = "AdminPass123!"): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

test("admin bootstrap and config APIs expose app list and editable JSON config", async () => {
  const runtime = createApplication({
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

  const configResponse = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/admin/apps/app_a/config",
    headers,
  });

  assert.equal(configResponse.statusCode, 200);
  assert.equal(configResponse.body.data.app.appId, "app_a");
  assert.equal(configResponse.body.data.configKey, "admin.delivery_config");
  assert.match(configResponse.body.data.rawJson, /featureFlags/);
});

test("admin config API saves normalized JSON back to the app config store", async () => {
  const runtime = createApplication({
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
    path: "/api/v1/admin/apps/app_b/config",
    headers,
    body: {
      rawJson: '{"release":{"version":"2026.03.21","channel":"stable"},"featureFlags":{"enableVipBanner":false},"settings":{"theme":"dawn"}}',
    },
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.body.data.app.appId, "app_b");
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

test("admin config API rejects invalid JSON and missing basic auth", async () => {
  const runtime = createApplication({
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
