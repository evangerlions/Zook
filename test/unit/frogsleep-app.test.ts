import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFrogSleepAuth,
  attachFrogSleepBodyAppId,
  FROGSLEEP_APP_ID,
  withFrogSleepAppId,
} from "../../src/modules/frogsleep/frogsleep-app.ts";
import { ApplicationError } from "../../src/shared/errors.ts";
import type { HttpRequest } from "../../src/shared/types.ts";

test("FrogSleep helper injects the app id into request bodies", () => {
  assert.equal(FROGSLEEP_APP_ID, "frogsleep");
  assert.deepEqual(withFrogSleepAppId({ email: "a@example.com" }), {
    appId: "frogsleep",
    email: "a@example.com",
  });

  const request = {
    method: "POST",
    path: "/v1/auth/password/login",
    headers: {},
    body: { account: "a@example.com" },
  } as HttpRequest;

  attachFrogSleepBodyAppId(request);

  assert.deepEqual(request.body, {
    appId: "frogsleep",
    account: "a@example.com",
  });
});

test("FrogSleep helper rejects non-FrogSleep auth context", () => {
  assert.throws(
    () =>
      assertFrogSleepAuth({
        appId: "app_a",
        userId: "user_alice",
        tokenId: "token_a",
        tokenVersion: 1,
        expiresAt: "2026-03-01T09:00:00.000Z",
      }),
    (error) =>
      error instanceof ApplicationError &&
      error.statusCode === 403 &&
      error.code === "AUTH_APP_SCOPE_MISMATCH",
  );
});
