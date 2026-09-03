import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { resolveLightTickEnvironment } from "../../src/modules/lighttick/lighttick-public-config.ts";
import { createApplication } from "../support/create-test-application.ts";

test("LightTick public environment collapses deployment names to the contract enum", () => {
  assert.equal(resolveLightTickEnvironment({ APP_ENV: "local", NODE_ENV: "development" }), "local");
  assert.equal(resolveLightTickEnvironment({ APP_ENV: "staging", NODE_ENV: "production" }), "dev");
  assert.equal(resolveLightTickEnvironment({ APP_ENV: "online", NODE_ENV: "development" }), "online");
  assert.equal(resolveLightTickEnvironment({ APP_ENV: undefined, NODE_ENV: "production" }), "online");
});

test("LightTick public config remains available while product capabilities are disabled", async () => {
  const runtime = await createApplication();

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/lighttick/public/config",
    headers: { "x-app-id": "lighttick" },
    requestId: "lighttick_public_config_disabled",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data, {
    app_id: "lighttick",
    enabled: false,
    environment: "local",
    configuration_version: "builtin-1",
    minimum_client_versions: { ios: "1.0.0", android: "1.0.0" },
    guest_session_ttl_seconds: 2_592_000,
    features: {
      guest_sessions: false,
      account_upgrade: false,
      sync: false,
      notifications: false,
      ai_coach: false,
    },
    privacy_policy_url: "https://api.zook.dev/api/v1/legal/privacy-policy",
    terms_of_service_url: "https://api.zook.dev/api/v1/legal/user-agreement",
    support_url: "https://api.zook.dev/support/lighttick",
    updated_at: "2026-08-19T00:00:00.000Z",
  });
});

test("LightTick public config exposes only the allowlisted non-secret contract", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  const config = seed.appConfigs.find((item) =>
    item.appId === "lighttick" && item.configKey === "admin.delivery_config");
  assert.ok(config);
  config.configValue = JSON.stringify({
    enabled: true,
    configurationVersion: "dev-42",
    minimumClientVersions: { ios: "1.2.0", android: "1.3.0" },
    guestSessionTtlSeconds: 604_800,
    featureFlags: {
      guestSessions: true,
      accountUpgrade: true,
      offlineSync: true,
      notifications: true,
      aiPlanning: true,
    },
    legal: {
      privacyPolicyUrl: "https://legal.example.com/lighttick/privacy",
      termsOfServiceUrl: "https://legal.example.com/lighttick/terms",
      supportUrl: "https://support.example.com/lighttick",
    },
    apiKey: "must-not-leak",
    settings: { internalBaseUrl: "http://internal.service", bearerToken: "must-not-leak" },
  });
  config.updatedAt = "2026-08-29T08:30:00.000Z";
  const runtime = await createApplication({ seed, lighttickEnabled: true });

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/lighttick/public/config",
    headers: {},
    requestId: "lighttick_public_config_enabled",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data, {
    app_id: "lighttick",
    enabled: true,
    environment: "local",
    configuration_version: "dev-42",
    minimum_client_versions: { ios: "1.2.0", android: "1.3.0" },
    guest_session_ttl_seconds: 604_800,
    features: {
      guest_sessions: true,
      account_upgrade: true,
      sync: true,
      notifications: true,
      ai_coach: true,
    },
    privacy_policy_url: "https://legal.example.com/lighttick/privacy",
    terms_of_service_url: "https://legal.example.com/lighttick/terms",
    support_url: "https://support.example.com/lighttick",
    updated_at: "2026-08-29T08:30:00.000Z",
  });
  assert.doesNotMatch(JSON.stringify(response.body), /must-not-leak|internal\.service|apiKey|bearerToken/);
});

test("LightTick public config rejects a mismatched app identity", async () => {
  const runtime = await createApplication();
  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/lighttick/public/config",
    headers: { "x-app-id": "bodylog" },
    requestId: "lighttick_public_config_scope",
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "AUTH_APP_SCOPE_MISMATCH");
});
