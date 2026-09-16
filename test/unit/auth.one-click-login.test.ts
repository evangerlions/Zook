import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

test("one-click login verifies provider token and persists session", async () => {
  const previousAppEnv = process.env.APP_ENV;
  process.env.APP_ENV = "dev";
  const runtime = await createApplication();
  await runtime.services.appConfigService.setValue(
    "common",
    "common.getui_gy_service",
    JSON.stringify({
      enabled: true,
      endpoint: "https://getui.example.test/gy_get_pn",
      timeoutMs: 1000,
      apps: {
        app_a: {
          appId: "getui-app-a",
          appKey: "app-key",
          appSecret: "app-secret",
          masterSecret: "master-secret",
        },
        flutter_demo: {
          appId: "getui-flutter",
          appKey: "flutter-app-key",
          appSecret: "flutter-app-secret",
          masterSecret: "flutter-master-secret",
        },
      },
    }),
  );

  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(
      JSON.stringify({
        errno: 0,
        data: {
          result: "20000",
          msg: "OK",
          data: {
            pn: encryptPhone("18710100985", "master-secret"),
          },
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    const response = await runtime.app.handle({
      method: "POST",
      path: "/api/v1/auth/login/one-click",
      headers: {
        "x-platform": "android",
        "x-app-region": "CN",
      },
      body: {
        appId: "app_a",
        token: "native-token",
        gyuid: "gy-user",
        operator: "CM",
        sdkPlatform: "android",
        clientType: "app",
      },
      ipAddress: "198.51.100.80",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.accountRegion, "CN");
    assert.ok(typeof response.body.data.accessToken === "string");
    assert.ok(typeof response.body.data.refreshToken === "string");
    assert.equal(response.body.data.user.phone, "+8618710100985");
    assert.equal(requests.length, 1);
    assert.equal((requests[0] as { appId: string }).appId, "getui-app-a");
    assert.equal((requests[0] as { token: string }).token, "native-token");

    const createdUser = runtime.database.findUserByPhone("+8618710100985");
    assert.ok(createdUser);
    assert.equal(createdUser.passwordAlgo, "sms-code-only");
    assert.ok(
      runtime.database.auditLogs.some(
        (item) =>
          item.action === "auth.login.one_click" &&
          item.resourceOwnerUserId === createdUser.id &&
          (item.payload as { replayRequest?: { body?: { token?: string } } })
            .replayRequest?.body?.token === "native-token" &&
          (item.payload as { providerRequest?: { body?: { token?: string } } })
            .providerRequest?.body?.token === "native-token",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreAppEnv(previousAppEnv);
  }
});

test("one-click login status fails fast when Getui config is missing", async () => {
  const runtime = await createApplication();
  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/auth/login/one-click/status",
    headers: {},
    query: {
      appId: "app_a",
    },
    body: null,
    ipAddress: "198.51.100.80",
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, "ONE_CLICK_SERVICE_NOT_CONFIGURED");
});

test("one-click login status reports backend readiness", async () => {
  const runtime = await createApplication();
  await runtime.services.appConfigService.setValue(
    "common",
    "common.getui_gy_service",
    JSON.stringify({
      enabled: true,
      endpoint: "https://getui.example.test/gy_get_pn",
      timeoutMs: 1000,
      apps: {
        app_a: {
          appId: "getui-app-a",
          appKey: "app-key",
          appSecret: "app-secret",
          masterSecret: "master-secret",
        },
        flutter_demo: {
          appId: "getui-flutter",
          appKey: "flutter-app-key",
          appSecret: "flutter-app-secret",
          masterSecret: "flutter-master-secret",
        },
      },
    }),
  );

  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/auth/login/one-click/status",
    headers: {},
    query: {
      appId: "app_a",
    },
    body: null,
    ipAddress: "198.51.100.80",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.available, true);
  assert.equal(response.body.data.provider, "getui_gy");
  assert.equal(response.body.data.providerAppId, "getui-app-a");
  assert.equal(
    response.body.data.endpoint,
    "https://getui.example.test/gy_get_pn",
  );
});

test("OHOS one-click login uses app-specific platform credentials without changing legacy credentials", async () => {
  const runtime = await createApplication();
  await runtime.services.appConfigService.setValue(
    "common",
    "common.getui_gy_service",
    JSON.stringify({
      enabled: true,
      endpoint: "https://getui.example.test/gy_get_pn",
      timeoutMs: 1000,
      apps: {
        ai_novel: {
          appId: "getui-legacy",
          appKey: "legacy-app-key",
          appSecret: "legacy-app-secret",
          masterSecret: "legacy-master-secret",
          platforms: {
            ohos: {
              appId: "getui-ohos",
              appKey: "ohos-app-key",
              appSecret: "ohos-app-secret",
              masterSecret: "ohos-master-secret",
            },
          },
        },
      },
    }),
  );
  const ohos = await runtime.services.commonGetuiGyConfigService.getRuntimeConfig(
    "ai_novel",
    "ohos",
  );
  assert.equal(ohos.appId, "getui-ohos");
  assert.equal(ohos.appKey, "ohos-app-key");
  assert.equal(ohos.appSecret, "ohos-app-secret");
  assert.equal(ohos.masterSecret, "ohos-master-secret");

  const legacy = await runtime.services.commonGetuiGyConfigService.getRuntimeConfig(
    "ai_novel",
    "android",
  );
  assert.equal(legacy.appId, "getui-legacy");
  assert.equal(legacy.appKey, "legacy-app-key");
  assert.equal(legacy.appSecret, "legacy-app-secret");
  assert.equal(legacy.masterSecret, "legacy-master-secret");
});

test("OHOS one-click login exchanges the token with the app-specific OHOS Getui AppID", async () => {
  const previousAppEnv = process.env.APP_ENV;
  process.env.APP_ENV = "dev";
  const runtime = await createApplication();
  await runtime.services.appConfigService.setValue(
    "common",
    "common.getui_gy_service",
    JSON.stringify({
      enabled: true,
      endpoint: "https://getui.example.test/gy_get_pn",
      timeoutMs: 1000,
      apps: {
        ai_novel: {
          appId: "getui-legacy",
          appKey: "legacy-app-key",
          appSecret: "legacy-app-secret",
          masterSecret: "legacy-master-secret",
          platforms: {
            ohos: {
              appId: "getui-ohos",
              appKey: "ohos-app-key",
              appSecret: "ohos-app-secret",
              masterSecret: "ohos-master-secret",
            },
          },
        },
      },
    }),
  );
  const originalFetch = globalThis.fetch;
  let providerRequest: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    providerRequest = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    return new Response(
      JSON.stringify({
        errno: 0,
        data: {
          result: "20000",
          msg: "OK",
          data: {
            pn: encryptPhone("18710100986", "ohos-master-secret"),
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const response = await runtime.app.handle({
      method: "POST",
      path: "/api/v1/auth/login/one-click",
      headers: {
        "x-platform": "ohos",
        "x-app-region": "CN",
      },
      body: {
        appId: "ai_novel",
        token: "ohos-native-token",
        gyuid: "ohos-gy-user",
        operator: "CM",
        sdkPlatform: "ohos",
        clientType: "app",
      },
      ipAddress: "198.51.100.81",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(providerRequest?.appId, "getui-ohos");
    assert.equal(providerRequest?.token, "ohos-native-token");
    assert.equal(response.body.data.user.phone, "+8618710100986");

    const status = await runtime.app.handle({
      method: "GET",
      path: "/api/v1/auth/login/one-click/status",
      headers: { "x-platform": "ohos" },
      query: { appId: "ai_novel" },
      body: null,
      ipAddress: "198.51.100.81",
    });
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.data.providerAppId, "getui-ohos");
  } finally {
    globalThis.fetch = originalFetch;
    restoreAppEnv(previousAppEnv);
  }
});

test("OHOS one-click login does not fall back to the base app credentials", async () => {
  const runtime = await createApplication();
  await runtime.services.appConfigService.setValue(
    "common",
    "common.getui_gy_service",
    JSON.stringify({
      enabled: true,
      endpoint: "https://getui.example.test/gy_get_pn",
      timeoutMs: 1000,
      apps: {
        app_a: {
          appId: "getui-app-a",
          appKey: "app-key",
          appSecret: "app-secret",
          masterSecret: "master-secret",
        },
      },
    }),
  );

  await assert.rejects(
    () => runtime.services.commonGetuiGyConfigService.getRuntimeConfig("app_a", "ohos"),
    /OHOS credentials are not configured/,
  );
});

test("one-click login reports missing Getui config", async () => {
  const previousAppEnv = process.env.APP_ENV;
  process.env.APP_ENV = "dev";
  const runtime = await createApplication();
  try {
    const response = await runtime.app.handle({
      method: "POST",
      path: "/api/v1/auth/login/one-click",
      headers: {},
      body: {
        appId: "app_a",
        token: "native-token",
        gyuid: "gy-user",
        clientType: "app",
      },
      ipAddress: "198.51.100.80",
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "ONE_CLICK_SERVICE_NOT_CONFIGURED");
    assert.ok(
      runtime.database.auditLogs.some(
        (item) =>
          item.action === "auth.login.one_click" &&
          (item.payload as { replayRequest?: { body?: { token?: string } } })
            .replayRequest?.body?.token === "native-token",
      ),
    );
  } finally {
    restoreAppEnv(previousAppEnv);
  }
});

test("one-click login does not audit replayable request outside dev", async () => {
  const previousAppEnv = process.env.APP_ENV;
  process.env.APP_ENV = "production";
  const runtime = await createApplication();
  try {
    await runtime.app.handle({
      method: "POST",
      path: "/api/v1/auth/login/one-click",
      headers: {},
      body: {
        appId: "app_a",
        token: "native-token",
        gyuid: "gy-user",
        clientType: "app",
      },
      ipAddress: "198.51.100.80",
    });

    const audit = runtime.database.auditLogs.find(
      (item) => item.action === "auth.login.one_click",
    );
    assert.ok(audit);
    const payload = audit.payload as {
      replayRequest?: unknown;
      providerRequest?: unknown;
      errorDetails?: unknown;
      requestSummary?: { tokenMasked?: string; gyuidMasked?: string };
    };
    assert.equal(payload.replayRequest, undefined);
    assert.equal(payload.providerRequest, undefined);
    assert.equal(payload.errorDetails, undefined);
    assert.ok(payload.requestSummary);
    assert.notEqual(payload.requestSummary?.tokenMasked, "native-token");
    assert.notEqual(payload.requestSummary?.gyuidMasked, "gy-user");
  } finally {
    restoreAppEnv(previousAppEnv);
  }
});

function encryptPhone(phone: string, masterSecret: string): string {
  const key = buildAesKey(masterSecret);
  const iv = Buffer.from("0000000000000000", "utf8");
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  cipher.setAutoPadding(true);
  return Buffer.concat([
    cipher.update(Buffer.from(phone, "utf8")),
    cipher.final(),
  ]).toString("hex");
}

function buildAesKey(masterSecret: string): Buffer {
  let key = masterSecret;
  while (key.length < 16) {
    key += masterSecret;
  }
  return Buffer.from(key.slice(0, 16), "utf8");
}

function restoreAppEnv(previousAppEnv: string | undefined): void {
  if (previousAppEnv === undefined) {
    delete process.env.APP_ENV;
    return;
  }
  process.env.APP_ENV = previousAppEnv;
}
