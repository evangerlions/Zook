import assert from "node:assert/strict";
import test from "node:test";
import { LogoutRequestSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { PublicContractValidator } from "../../src/generated/openapi/public-contract-validator.ts";
import { createApplication } from "../support/create-test-application.ts";

test("app current-session logout publishes and validates the opaque refresh credential", () => {
  assert.equal((LogoutRequestSchema.properties as Record<string, { type: string }>).refreshToken?.type, "string");
  const valid = PublicContractValidator.validateLogout({ appId: "yaohezi", scope: "current", refreshToken: "opaque-refresh-fixture" });
  assert.equal(valid.ok, true);
  const invalid = PublicContractValidator.validateLogout({ appId: "yaohezi", scope: "current", refreshToken: 123 });
  assert.equal(invalid.ok, false);
});

test("web and all-session logout retain their compatible optional-body contract", () => {
  assert.equal(PublicContractValidator.validateLogout({}).ok, true);
  assert.equal(PublicContractValidator.validateLogout({ scope: "all" }).ok, true);
});

test("canonical logout passes the app refresh credential to the real session manager and rejects wrong app scope", async () => {
  const runtime = await createApplication();
  const login = await runtime.app.handle({ method: "POST", path: "/api/v1/auth/login", headers: {},
    body: { appId: "app_a", account: "alice@example.com", password: "Password1234", clientType: "app" }, ipAddress: "198.51.100.42" });
  assert.equal(login.statusCode, 200);
  const headers = { authorization: `Bearer ${login.body.data.accessToken}`, "x-app-id": "app_a" };
  const wrong = await runtime.app.handle({ method: "POST", path: "/api/v1/auth/logout", headers,
    body: { appId: "app_b", scope: "current", refreshToken: login.body.data.refreshToken } });
  assert.equal(wrong.statusCode, 403);
  const missing = await runtime.app.handle({ method: "POST", path: "/api/v1/auth/logout", headers, body: { scope: "current" } });
  assert.equal(missing.statusCode, 401);
  const logout = await runtime.app.handle({ method: "POST", path: "/api/v1/auth/logout", headers,
    body: { appId: "app_a", scope: "current", refreshToken: login.body.data.refreshToken } });
  assert.equal(logout.statusCode, 200);
  const refresh = await runtime.app.handle({ method: "POST", path: "/api/v1/auth/refresh", headers: {},
    body: { appId: "app_a", refreshToken: login.body.data.refreshToken, clientType: "app" } });
  assert.equal(refresh.statusCode, 401);
});
