import assert from "node:assert/strict";
import test from "node:test";

import { createApplication } from "../support/create-test-application.ts";

const WECHAT_OPEN_ID = "fixture-open-id";
const NICKNAME = "橘子写作者";

test("WeChat reauthorization fills in an existing binding nickname", async () => {
  let profile: { openid: string; nickname: string } | undefined;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.weixin.qq.com");
    if (url.pathname === "/sns/oauth2/access_token") {
      return Response.json({
        openid: WECHAT_OPEN_ID,
        unionid: "fixture-union-id",
        access_token: "fixture-access-token",
      });
    }
    assert.equal(url.pathname, "/sns/userinfo");
    assert.equal(url.searchParams.get("openid"), WECHAT_OPEN_ID);
    assert.equal(url.searchParams.get("access_token"), "fixture-access-token");
    return profile ? Response.json(profile) : new Response(null, { status: 503 });
  };

  const runtime = await createApplication({
    identityAuth: {
      clients: {
        async get() { return { clientId: "fixture-wechat-app", secretKey: "wechat-secret" }; },
        async readSecret() { return "fixture-secret"; },
      },
      fetcher,
    },
  });
  const headers = { "x-app-id": "ai_novel", "x-platform": "ios", "x-app-region": "CN" };
  const post = (path: string, body: object) => runtime.app.handle({
    method: "POST", path, body: { appId: "ai_novel", ...body }, headers,
    ipAddress: "192.0.2.50",
  });

  async function login() {
    const authorization = await post("/api/v1/auth/third-party/authorizations", {
      provider: "wechat", purpose: "login", clientType: "app",
    });
    assert.equal(authorization.statusCode, 200);
    const { authorizationId, parameters } = authorization.body.data;
    const result = await post("/api/v1/auth/login/third-party", {
      authorizationId, clientType: "app",
      credential: { type: "authorization_code", code: "fixture-code", state: parameters.state },
    });
    assert.equal(result.statusCode, 200);
    return result.body.data;
  }

  try {
    const original = await login();
    assert.deepEqual(original.user.accountSecurity.bindings, [{ kind: "wechat" }]);

    profile = { openid: WECHAT_OPEN_ID, nickname: ` ${NICKNAME} ` };
    const updated = await login();
    assert.equal(updated.user.id, original.user.id);
    assert.deepEqual(updated.user.accountSecurity.bindings, [{ kind: "wechat", displayName: NICKNAME }]);

    profile = { openid: "different-open-id", nickname: "Different account" };
    const unchanged = await login();
    assert.deepEqual(unchanged.user.accountSecurity.bindings, [{ kind: "wechat", displayName: NICKNAME }]);

    const me = await runtime.app.handle({
      method: "GET", path: "/api/v1/users/me",
      headers: { ...headers, authorization: `Bearer ${unchanged.accessToken}` },
    });
    assert.equal(me.statusCode, 200);
    assert.deepEqual(me.body.data.user.accountSecurity.bindings, [{ kind: "wechat", displayName: NICKNAME }]);
  } finally {
    await runtime.close();
  }
});
