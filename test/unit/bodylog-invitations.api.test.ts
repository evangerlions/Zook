import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import type { DatabaseSeed } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

function seed(): DatabaseSeed {
  const value = buildDefaultSeed();
  value.apps?.push({
    id: "bodylog", code: "bodylog", name: "BodyLog",
    nameI18n: { "zh-CN": "BodyLog", "en-US": "BodyLog" },
    status: "ACTIVE", apiDomain: "bodylog.example.com", joinMode: "AUTO",
    createdAt: new Date().toISOString(),
  });
  for (const userId of ["user_alice", "user_bob"]) {
    value.appUsers?.push({
      id: `app_${userId}_bodylog`, appId: "bodylog", userId,
      status: "ACTIVE", joinedAt: new Date().toISOString(),
    });
  }
  return value;
}

test("invitation binds once and qualifies after three distinct current-or-recorded plan days", async () => {
  const runtime = await createApplication({ seed: seed() });
  const alice = runtime.services.tokenService.issueAccessToken("user_alice", "bodylog");
  const bob = runtime.services.tokenService.issueAccessToken("user_bob", "bodylog");
  const headers = (token: string) => ({
    authorization: `Bearer ${token}`, "x-app-id": "bodylog",
  });

  const invitation = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/invitations", headers: headers(alice),
    body: { installId: "install-alice-123" },
  });
  assert.equal(invitation.statusCode, 200);
  assert.match(invitation.body.data.url, /^https:\/\/bodylog\.app\/i\//);

  const attributed = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/invitations/attribute", headers: headers(bob),
    body: { token: invitation.body.data.token, installId: "install-bob-123" },
  });
  assert.equal(attributed.body.data.attributed, true);

  const duplicate = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/invitations/attribute", headers: headers(bob),
    body: { token: invitation.body.data.token, installId: "install-bob-other" },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.body.code, "BODYLOG_INVITATION_ALREADY_ATTRIBUTED");

  const records = await runtime.database.listBodyLogInvitationAttributions("bodylog");
  await runtime.database.updateBodyLogInvitationAttribution({
    ...records[0],
    completedDates: ["2026-07-26", "2026-07-27"],
  });
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const progress = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/invitations/progress", headers: headers(bob),
    body: { date: today, timezone: "UTC" },
  });
  assert.equal(progress.body.data.progressDays, 3);
  assert.equal(progress.body.data.qualified, true);
  assert.equal(typeof progress.body.data.premiumUntil, "string");

  const status = await runtime.app.handle({
    method: "GET", path: "/api/v1/bodylog/invitations", headers: headers(alice),
  });
  assert.equal(status.body.data.qualifiedCount, 1);
  assert.equal(status.body.data.rewardedCount, 1);
  assert.equal(typeof status.body.data.premiumUntil, "string");
});

test("self invitation is rejected", async () => {
  const runtime = await createApplication({ seed: seed() });
  const alice = runtime.services.tokenService.issueAccessToken("user_alice", "bodylog");
  const headers = { authorization: `Bearer ${alice}`, "x-app-id": "bodylog" };
  const invitation = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/invitations", headers,
    body: { installId: "install-alice-123" },
  });
  const response = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/invitations/attribute", headers,
    body: { token: invitation.body.data.token, installId: "install-alice-123" },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, "BODYLOG_INVITATION_INVALID");
});
