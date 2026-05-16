import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

test("one-click login verifies provider token and persists session", async () => {
  const runtime = await createApplication();
  await runtime.services.commonPasswordConfigService.set(
    "getui.gy.app_key",
    "Getui app key",
    "app-key",
  );
  await runtime.services.commonPasswordConfigService.set(
    "getui.gy.master_secret",
    "Getui master secret",
    "master-secret",
  );
  await runtime.services.appConfigService.setValue(
    "common",
    "common.getui_gy_service",
    JSON.stringify({
      enabled: true,
      appId: "getui-app-id",
      endpoint: "https://getui.example.test/gy_get_pn",
      appKey: "{{ zook.ps.getui.gy.app_key }}",
      masterSecret: "{{ zook.ps.getui.gy.master_secret }}",
      timeoutMs: 1000,
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
      headers: {},
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
    assert.ok(typeof response.body.data.accessToken === "string");
    assert.ok(typeof response.body.data.refreshToken === "string");
    assert.equal(response.body.data.user.phone, "+8618710100985");
    assert.equal(requests.length, 1);
    assert.equal((requests[0] as { appId: string }).appId, "getui-app-id");
    assert.equal((requests[0] as { token: string }).token, "native-token");

    const createdUser = runtime.database.findUserByPhone("+8618710100985");
    assert.ok(createdUser);
    assert.equal(createdUser.passwordAlgo, "sms-code-only");
    assert.ok(
      runtime.database.auditLogs.some(
        (item) =>
          item.action === "auth.login.one_click" &&
          item.resourceOwnerUserId === createdUser.id,
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("one-click login reports missing Getui config", async () => {
  const runtime = await createApplication();
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
