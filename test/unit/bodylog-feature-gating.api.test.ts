import assert from "node:assert/strict";
import test from "node:test";
import { resolveBodyLogStores } from "../../src/application-bodylog-stores.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";

async function setup() {
  const seed = buildDefaultSeed();
  seed.apps!.push({
    id: "bodylog", code: "bodylog", name: "BodyLog",
    nameI18n: { "zh-CN": "BodyLog", "en-US": "BodyLog" },
    status: "ACTIVE", apiDomain: "bodylog.example.com", joinMode: "AUTO",
    createdAt: new Date().toISOString(),
  });
  seed.appUsers!.push({
    id: "app_user_alice_bodylog", appId: "bodylog", userId: "user_alice",
    status: "ACTIVE", joinedAt: new Date().toISOString(),
  });
  const runtime = await createApplication({ seed });
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "bodylog");
  const headers = { authorization: `Bearer ${token}`, "x-app-id": "bodylog" };
  const call = (method: "GET" | "POST", path: string) => runtime.app.handle({
    method, path: `/api/v1/bodylog/${path}`, headers,
  });
  return { runtime, call };
}

test("BodyLog capability flags fail closed for social and competition routes", async () => {
  const { call } = await setup();
  for (const path of ["profile", "friends", "buddies", "groups"]) {
    const response = await call("GET", path);
    assert.equal(response.statusCode, 404, path);
    assert.equal(response.body.code, "BODYLOG_FEATURE_DISABLED", path);
  }
  for (const path of ["challenges", "leaderboards/current/public"]) {
    const response = await call("GET", path);
    assert.equal(response.statusCode, 404, path);
    assert.equal(response.body.code, "BODYLOG_FEATURE_DISABLED", path);
  }
});

test("friends and challenge creation flags can roll back independently", async () => {
  const { runtime, call } = await setup();
  const flags = resolveBodyLogStores(runtime.database).flags;
  await flags.updateBodyLogFeatureFlag("accountSocial", true);
  await flags.updateBodyLogFeatureFlag("competition", true);

  assert.equal((await call("GET", "profile")).statusCode, 200);
  const friendsOff = await call("GET", "friends");
  assert.equal(friendsOff.statusCode, 404);
  assert.equal(friendsOff.body.code, "BODYLOG_FEATURE_DISABLED");

  const challengesReadable = await call("GET", "challenges");
  assert.equal(challengesReadable.statusCode, 200);
  const createDisabled = await call("POST", "challenges");
  assert.equal(createDisabled.statusCode, 404);
  assert.equal(createDisabled.body.code, "BODYLOG_FEATURE_DISABLED");
});
