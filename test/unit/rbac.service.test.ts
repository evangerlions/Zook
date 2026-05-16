import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

test("rbac service grants admin permissions through app-scoped roles", async () => {
  const runtime = await createApplication();

  assert.equal(await runtime.services.rbacService.hasPermission("app_a", "user_alice", "metrics:read"), true);
  assert.equal(await runtime.services.rbacService.hasPermission("app_a", "user_alice", "notification:send"), true);
});

test("rbac service keeps member permissions narrower than admin permissions", async () => {
  const runtime = await createApplication();
  await runtime.services.authService.login({
    appId: "app_a",
    account: "bob@example.com",
    password: "Password1234",
  });

  assert.equal(await runtime.services.rbacService.hasPermission("app_a", "user_bob", "file:read"), true);
  assert.equal(await runtime.services.rbacService.hasPermission("app_a", "user_bob", "metrics:read"), false);
  await assert.rejects(
    runtime.services.rbacService.assertPermission("app_a", "user_bob", "metrics:read"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "IAM_PERMISSION_DENIED",
  );
});
