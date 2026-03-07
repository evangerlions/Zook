import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";

test("rbac service grants admin permissions through app-scoped roles", () => {
  const runtime = createApplication();

  assert.equal(runtime.services.rbacService.hasPermission("app_a", "user_alice", "metrics:read"), true);
  assert.equal(runtime.services.rbacService.hasPermission("app_a", "user_alice", "notification:send"), true);
});

test("rbac service keeps member permissions narrower than admin permissions", () => {
  const runtime = createApplication();
  runtime.services.authService.login({
    appId: "app_a",
    account: "bob@example.com",
    password: "Password1234",
  });

  assert.equal(runtime.services.rbacService.hasPermission("app_a", "user_bob", "file:read"), true);
  assert.equal(runtime.services.rbacService.hasPermission("app_a", "user_bob", "metrics:read"), false);
  assert.throws(
    () => runtime.services.rbacService.assertPermission("app_a", "user_bob", "metrics:read"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "IAM_PERMISSION_DENIED",
  );
});
