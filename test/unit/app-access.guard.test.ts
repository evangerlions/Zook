import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";

test("app access guard rejects explicit appId mismatches against the bearer token", async () => {
  const runtime = await createApplication();
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "app_a");
  const request = {
    method: "GET",
    path: "/api/v1/admin/metrics/overview",
    headers: {
      authorization: `Bearer ${token}`,
    },
    query: {
      appId: "app_b",
    },
  };

  const auth = runtime.services.authGuard.canActivate(request);
  assert.throws(
    () => runtime.services.appAccessGuard.assertScope(request.query.appId, auth.appId),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_APP_SCOPE_MISMATCH",
  );
});

test("app context resolver rejects X-App-Id mismatches after authentication", async () => {
  const runtime = await createApplication();
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "app_a");
  const request = {
    method: "GET",
    path: "/api/v1/admin/metrics/overview",
    headers: {
      authorization: `Bearer ${token}`,
      "x-app-id": "app_b",
    },
  };

  const auth = runtime.services.authGuard.canActivate(request);
  assert.throws(
    () => runtime.services.appContextResolver.resolvePostAuth(request, auth.appId),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_APP_SCOPE_MISMATCH",
  );
});
