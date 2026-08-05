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
