import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

function setAliceRegion(
  runtime: Awaited<ReturnType<typeof createApplication>>,
  accountRegion: "CN" | "GLOBAL" | "UNKNOWN",
): void {
  const membership = runtime.database.appUsers.find(
    (item) => item.appId === "app_a" && item.userId === "user_alice",
  );
  assert.ok(membership);
  membership.accountRegion = accountRegion;
}

async function login(
  runtime: Awaited<ReturnType<typeof createApplication>>,
  headers: Record<string, string>,
  clientType: "app" | "web" = "app",
) {
  return runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/login",
    headers,
    body: {
      appId: "app_a",
      account: "alice@example.com",
      password: "Password1234",
      clientType,
    },
    ipAddress: "198.51.100.10",
  });
}

test("authoritative products finalize UNKNOWN from the first concrete region", async () => {
  const runtime = await createApplication();

  const response = await login(runtime, {
    "x-platform": "android",
    "x-app-region": "CN",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.accountRegion, "CN");
});

test("authoritative Android and Web products allow both matching regions", async () => {
  for (const platform of ["android", "web"] as const) {
    for (const region of ["CN", "GLOBAL"] as const) {
      const runtime = await createApplication();
      setAliceRegion(runtime, region);

      const response = await login(
        runtime,
        {
          "x-platform": platform,
          "x-app-region": region,
        },
        platform === "web" ? "web" : "app",
      );

      assert.equal(response.statusCode, 200, `${platform}:${region}`);
      assert.equal(response.body.data.accountRegion, region);
    }
  }
});

test("both Android mismatch directions return neutral localized 403 responses", async () => {
  const cnRuntime = await createApplication();
  setAliceRegion(cnRuntime, "CN");
  const globalProductResponse = await login(cnRuntime, {
    "x-platform": "android",
    "x-app-region": "GLOBAL",
    "x-app-locale": "en-US",
  });
  assert.deepEqual(globalProductResponse.body, {
    code: "AUTH_LOGIN_FORBIDDEN",
    message: "This account cannot sign in here.",
    data: null,
    requestId: globalProductResponse.body.requestId,
  });
  assert.equal(globalProductResponse.statusCode, 403);

  const globalRuntime = await createApplication();
  setAliceRegion(globalRuntime, "GLOBAL");
  const cnProductResponse = await login(globalRuntime, {
    "x-platform": "android",
    "x-app-region": "CN",
    "x-app-locale": "zh-CN",
  });
  assert.equal(cnProductResponse.statusCode, 403);
  assert.equal(cnProductResponse.body.code, "AUTH_LOGIN_FORBIDDEN");
  assert.equal(cnProductResponse.body.message, "此账号无法在此登录");
  assert.equal(cnProductResponse.body.data, null);
});

test("Web mismatch clears its refresh cookie and keeps mismatch details audit-only", async () => {
  const runtime = await createApplication();
  setAliceRegion(runtime, "CN");

  const response = await login(
    runtime,
    {
      "x-platform": "web",
      "x-app-region": "GLOBAL",
      "x-app-locale": "zh-CN",
    },
    "web",
  );

  assert.equal(response.statusCode, 403);
  assert.match(response.headers?.["Set-Cookie"] ?? "", /refreshToken=;/);
  assert.match(response.headers?.["Set-Cookie"] ?? "", /Max-Age=0/);
  assert.equal(JSON.stringify(response.body).includes("GLOBAL"), false);
  assert.equal(JSON.stringify(response.body).includes("CN"), false);
  const denial = runtime.database.auditLogs.find(
    (record) => record.action === "auth.account_region_access.denied",
  );
  assert.deepEqual(denial?.payload, {
    accountRegion: "CN",
    productRegion: "GLOBAL",
    platform: "web",
    appVersion: undefined,
    requestId: response.body.requestId,
  });
});

test("legacy and Apple requests remain compatible", async () => {
  for (const headers of [
    {},
    { "x-platform": "android" },
    { "x-platform": "android", "x-app-region": "invalid" },
    { "x-platform": "ios", "x-app-region": "GLOBAL" },
    { "x-platform": "ipados", "x-app-region": "GLOBAL" },
    { "x-platform": "macos", "x-app-region": "GLOBAL" },
  ]) {
    const runtime = await createApplication();
    setAliceRegion(runtime, "CN");
    const response = await login(runtime, headers);
    assert.equal(response.statusCode, 200, JSON.stringify(headers));
  }
});

test("the same guard rejects users/me and representative protected APIs", async () => {
  const runtime = await createApplication();
  setAliceRegion(runtime, "CN");
  const session = await runtime.services.authService.issueSession(
    "user_alice",
    "app_a",
  );
  const headers = {
    authorization: `Bearer ${session.accessToken}`,
    "x-app-id": "app_a",
    "x-platform": "android",
    "x-app-region": "GLOBAL",
    "x-app-locale": "en-US",
  };

  for (const path of ["/api/v1/users/me", "/api/v1/logs/policy"]) {
    const response = await runtime.app.handle({ method: "GET", path, headers });
    assert.equal(response.statusCode, 403, path);
    assert.equal(response.body.code, "AUTH_LOGIN_FORBIDDEN", path);
  }
});

test("refresh mismatch exposes no tokens and does not revoke another device session", async () => {
  const runtime = await createApplication();
  setAliceRegion(runtime, "CN");
  const rejectedDevice = await runtime.services.authService.issueSession(
    "user_alice",
    "app_a",
  );
  const otherDevice = await runtime.services.authService.issueSession(
    "user_alice",
    "app_a",
  );
  const recordsBefore = await runtime.services.refreshTokenStore.listByUserAndApp(
    "app_a",
    "user_alice",
  );

  const rejectedResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/refresh",
    headers: {
      "x-platform": "android",
      "x-app-region": "GLOBAL",
    },
    body: {
      appId: "app_a",
      refreshToken: rejectedDevice.refreshToken,
      clientType: "app",
    },
  });
  assert.equal(rejectedResponse.statusCode, 403);
  assert.equal(rejectedResponse.body.data, null);
  assert.equal(JSON.stringify(rejectedResponse.body).includes("Token"), false);

  const recordsAfter = await runtime.services.refreshTokenStore.listByUserAndApp(
    "app_a",
    "user_alice",
  );
  const previousIds = new Set(recordsBefore.map((record) => record.id));
  const newlyIssuedRecords = recordsAfter.filter(
    (record) => !previousIds.has(record.id),
  );
  assert.equal(newlyIssuedRecords.length, 1);
  assert.ok(newlyIssuedRecords[0]?.revokedAt);

  const rejectedOriginal =
    await runtime.services.refreshTokenStore.getByRawToken(
      rejectedDevice.refreshToken,
    );
  assert.equal(rejectedOriginal?.replacedBy, newlyIssuedRecords[0]?.id);
  assert.ok(rejectedOriginal?.revokedAt);

  const otherDeviceRecord =
    await runtime.services.refreshTokenStore.getByRawToken(
      otherDevice.refreshToken,
    );
  assert.equal(otherDeviceRecord?.revokedAt, undefined);
  assert.equal(
    recordsAfter.filter((record) => !record.revokedAt).length,
    1,
  );

  const otherDeviceResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/refresh",
    headers: {},
    body: {
      appId: "app_a",
      refreshToken: otherDevice.refreshToken,
      clientType: "app",
    },
  });
  assert.equal(otherDeviceResponse.statusCode, 200);
});
