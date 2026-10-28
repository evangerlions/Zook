import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { resolveBodyLogStores } from "../../src/application-bodylog-stores.ts";
import { createApplication } from "../support/create-test-application.ts";

async function setup() {
  const seed = buildDefaultSeed();
  seed.apps!.push({ id: "bodylog", code: "bodylog", name: "BodyLog",
    nameI18n: { "zh-CN": "BodyLog", "en-US": "BodyLog" }, status: "ACTIVE",
    apiDomain: "bodylog.example.com", joinMode: "AUTO", createdAt: new Date().toISOString() });
  for (const userId of ["user_alice", "user_bob"]) seed.appUsers!.push({
    id: `app_${userId}_bodylog`, appId: "bodylog", userId,
    status: "ACTIVE", joinedAt: new Date().toISOString(),
  });
  const runtime = await createApplication({ seed });
  const stores = resolveBodyLogStores(runtime.database);
  await stores.flags.updateBodyLogFeatureFlag("accountSocial", true);
  await stores.flags.updateBodyLogFeatureFlag("growth", true);
  const token = (userId: string) => runtime.services.tokenService.issueAccessToken(userId, "bodylog");
  const request = (userId: string, path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => runtime.app.handle({
    method, path: `/api/v1/bodylog${path}`,
    headers: { authorization: `Bearer ${token(userId)}`, "x-app-id": "bodylog" }, body,
  });
  const created = await request("user_alice", "/invitations", { installId: "install-alice-stable" });
  assert.equal(created.statusCode, 200);
  const invitation = created.body.data;
  const attribute = (invitationToken = invitation.token, installId = "install-bob-stable") =>
    request("user_bob", "/invitations/attribute", { token: invitationToken, installId });
  const today = new Date().toISOString().slice(0, 10);
  const progress = () => request("user_bob", "/invitations/progress", { date: today, timezone: "UTC" });
  const preview = (query: Record<string, string | undefined>, userId = "user_bob") => runtime.app.handle({
    method: "GET", path: "/api/v1/bodylog/invitations/preview", query,
    headers: { authorization: `Bearer ${token(userId)}`, "x-app-id": "bodylog" },
  });
  return { runtime, stores, request, invitation, attribute, today, progress, preview };
}

test("same-account same-token same-install attribution retries confirm the existing binding", async () => {
  const { runtime, attribute } = await setup();
  const first = await attribute();
  assert.equal(first.statusCode, 200);
  const repeated = await attribute();
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.body.data.attributed, true);
  assert.equal((await runtime.database.listBodyLogInvitationAttributions("bodylog")).length, 1);
});

test("growth invitation intents retain the attribution link namespace instead of masquerading as relationships", async () => {
  const { request } = await setup();
  for (const intent of ["general", "buddy", "group"]) {
    const response = await request("user_alice", "/invitations", {
      installId: "install-alice-stable", intent,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.url, `https://bodylog.app/i/${response.body.data.token}`);
  }
});

test("attribution replay does not silently change its invitation or installation", async () => {
  const { runtime, request, attribute } = await setup();
  assert.equal((await attribute()).statusCode, 200);
  const second = await request("user_alice", "/invitations", { installId: "install-alice-stable" });
  assert.equal(second.statusCode, 200);
  assert.equal((await attribute(second.body.data.token)).statusCode, 409);
  assert.equal((await attribute(undefined, "install-bob-replaced")).statusCode, 409);
  assert.equal((await runtime.database.listBodyLogInvitationAttributions("bodylog")).length, 1);
});

test("posting today's date without a recorded qualifying local goal cannot earn invitation progress", async () => {
  const { runtime, attribute, progress } = await setup();
  assert.equal((await attribute()).statusCode, 200);
  const response = await progress();
  assert.equal(response.statusCode, 409);
  const [record] = await runtime.database.listBodyLogInvitationAttributions("bodylog");
  assert.deepEqual(record?.completedDates, []);
  assert.equal(record?.qualifiedAt, undefined);
  assert.equal(record?.inviteeRewardEndsAt, undefined);
});

test("a recorded qualifying aggregate counts once and a correction removes unqualified invitation progress", async () => {
  const { runtime, stores, request, attribute, today, progress } = await setup();
  assert.equal((await attribute()).statusCode, 200);
  const enrollment = await request("user_bob", "/seven-day-plan/enroll", { timeZone: "UTC" });
  assert.equal(enrollment.statusCode, 200);
  const plan = enrollment.body.data;
  const aggregate = { localDate: today, timeZone: "UTC", completedGoalCount: 1,
    eligibleGoalCount: 1, definitionVersion: 1, eventId: randomUUID() };
  const uploaded = await request("user_bob", `/seven-day-plan/${plan.id}/daily-aggregate`, aggregate);
  assert.equal(uploaded.statusCode, 200);
  assert.equal((await progress()).body.data.progressDays, 1);
  assert.equal((await progress()).body.data.progressDays, 1);
  const corrected = await request("user_bob", `/seven-day-plan/${plan.id}/daily-aggregate`, {
    ...aggregate, completedGoalCount: 0,
  });
  assert.equal(corrected.statusCode, 200);
  assert.equal((await stores.growth.findGrowthMissionsByPlanId(plan.id))[0]?.completed, false);
  const refreshed = await progress();
  // The server may signal that today's goal is no longer eligible; list still
  // needs to remove the unqualified date rather than retaining fabricated work.
  assert.ok([200, 409].includes(refreshed.statusCode));
  const summary = await request("user_bob", "/invitations");
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.body.data.inviteeProgressDays, 0);
  const [record] = await runtime.database.listBodyLogInvitationAttributions("bodylog");
  assert.deepEqual(record?.completedDates, []);
});

test("authenticated token and six-character code previews return only invitation metadata without binding", async () => {
  const { runtime, invitation, preview } = await setup();
  for (const query of [{ token: invitation.token }, { code: invitation.code }]) {
    const response = await preview(query);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data, {
      intent: "general", code: invitation.code, expiresAt: invitation.expiresAt,
    });
  }
  assert.deepEqual(await runtime.database.listBodyLogInvitationAttributions("bodylog"), []);
});

test("preview requires exactly one valid locator plus authentication and the social capability", async () => {
  const { runtime, stores, invitation, preview } = await setup();
  for (const query of [{}, { token: invitation.token, code: invitation.code }, { code: "X" }]) {
    assert.equal((await preview(query)).statusCode, 400);
  }
  const anonymous = await runtime.app.handle({
    method: "GET", path: "/api/v1/bodylog/invitations/preview",
    query: { code: invitation.code }, headers: { "x-app-id": "bodylog" },
  });
  assert.equal(anonymous.statusCode, 401);
  await stores.flags.updateBodyLogFeatureFlag("accountSocial", false);
  const disabled = await preview({ code: invitation.code });
  assert.equal(disabled.statusCode, 404);
  assert.equal(disabled.body.code, "BODYLOG_FEATURE_DISABLED");
});

test("only the invitation owner can revoke, duplicate revocation confirms success, and new attribution is rejected", async () => {
  const { invitation, request, attribute, preview } = await setup();
  const path = `/invitations/${invitation.token}`;
  const wrongAccount = await request("user_bob", path, undefined, "DELETE");
  assert.ok([403, 404].includes(wrongAccount.statusCode));
  assert.equal((await preview({ token: invitation.token })).statusCode, 200);
  for (let attempt = 0; attempt < 2; attempt++) {
    const revoked = await request("user_alice", path, undefined, "DELETE");
    assert.equal(revoked.statusCode, 200);
    assert.deepEqual(revoked.body.data, { revoked: true });
  }
  assert.equal((await attribute()).statusCode, 410);
  assert.equal((await preview({ code: invitation.code })).statusCode, 410);
});

test("revocation does not erase a confirmed same-token same-install attribution receipt", async () => {
  const { runtime, invitation, request, attribute } = await setup();
  assert.equal((await attribute()).statusCode, 200);
  assert.equal((await request("user_alice", `/invitations/${invitation.token}`, undefined, "DELETE")).statusCode, 200);
  const confirmed = await attribute();
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.body.data.attributed, true);
  assert.equal((await runtime.database.listBodyLogInvitationAttributions("bodylog")).length, 1);
});
