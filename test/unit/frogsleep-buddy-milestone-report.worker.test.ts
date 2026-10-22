import assert from "node:assert/strict";
import test from "node:test";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
import { createApplication } from "../../src/app.module.ts";
import { BuddyJointActivityService } from "../../src/modules/frogsleep/buddy-growth/buddy-joint-activity.service.ts";
import { BuddyMilestoneReportService } from "../../src/modules/frogsleep/buddy-growth/buddy-milestone-report.service.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function runtime() {
  return await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed) });
}

async function login(app: Awaited<ReturnType<typeof runtime>>, account: string) {
  const response = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/auth/password/login",
    headers: {}, body: { account, password: "Password1234" }, requestId: `report_login_${account}` } as never);
  return String(response.body.data.access_token);
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function acceptedRelationship(app: Awaited<ReturnType<typeof runtime>>, alice: string, bob: string) {
  const invite = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites",
    headers: auth(alice), body: { invitee: "user_bob" }, requestId: "report_invite" } as never);
  const accepted = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/sleep-buddy/invites/accept-code",
    headers: auth(bob), body: { code: invite.body.data.code }, requestId: "report_accept" } as never);
  const id = String(accepted.body.data.relationship_id);
  await app.database.updateFrogSleepEntity("sleep_relationship", "frogsleep", id,
    { createdAt: "2026-07-13T00:00:00.000Z" });
  return id;
}

async function insertAction(app: Awaited<ReturnType<typeof runtime>>, input: {
  id: string; kind: "buddy_interaction" | "buddy_joint_activity" | "sleep_session" | "buddy_goal_contribution";
  relationshipId: string; owner: string; status: string; at: string;
}) {
  await app.database.insertFrogSleepEntity({ id: input.id, appId: "frogsleep", kind: input.kind,
    ownerUserId: input.owner, partnerUserId: input.owner === "user_alice" ? "user_bob" : "user_alice",
    relationshipId: input.relationshipId, status: input.status,
    payload: input.kind === "sleep_session"
      ? { participantStates: { [input.owner]: "morning_completed" } } : { amount: 1 },
    occurredAt: input.at, createdAt: input.at, updatedAt: input.at });
  if (input.kind === "sleep_session") await app.database.insertFrogSleepEntity({
    id: `${input.id}_morning`, appId: "frogsleep", kind: "sleep_event", sessionId: input.id,
    relationshipId: input.relationshipId, ownerUserId: input.owner, status: "morning_completed",
    occurredAt: input.at, payload: { event_type: "morning_completed" }, createdAt: input.at, updatedAt: input.at });
}

test("worker deduplicates milestones and weekly reports while measuring meaningful activity", async () => {
  const app = await runtime(); const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com"); const relationshipId = await acceptedRelationship(app, alice, bob);
  await insertAction(app, { id: "interaction_1", kind: "buddy_interaction", relationshipId,
    owner: "user_alice", status: "sent", at: "2026-07-15T10:00:00.000Z" });
  const startedAt = "2026-07-15T22:00:00.000Z";
  const completedAt = "2026-07-16T09:00:00.000Z";
  await app.database.insertFrogSleepEntity({ id: "joint_1", appId: "frogsleep", kind: "buddy_joint_activity",
    relationshipId, ownerUserId: "user_bob", partnerUserId: "user_alice", status: "accepted",
    payload: { type: "tonight_together", accepted_at: startedAt, expires_at: "2026-07-17T10:00:00.000Z",
      participant_started_at: { user_alice: startedAt, user_bob: startedAt } }, createdAt: startedAt, updatedAt: startedAt });
  await app.database.insertFrogSleepEntity({ id: "actual_morning", appId: "frogsleep", kind: "sleep_session",
    relationshipId, ownerUserId: "user_alice", partnerUserId: "user_bob", status: "completed",
    startsAt: startedAt, occurredAt: completedAt, payload: { participantStates: {
      user_alice: "morning_completed", user_bob: "morning_completed" } }, createdAt: startedAt, updatedAt: completedAt });
  for (const userId of ["user_alice", "user_bob"]) await app.database.insertFrogSleepEntity({
    id: `actual_morning_${userId}`, appId: "frogsleep", kind: "sleep_event", sessionId: "actual_morning",
    relationshipId, ownerUserId: userId, status: "morning_completed", occurredAt: completedAt,
    payload: { event_type: "morning_completed" }, createdAt: completedAt, updatedAt: completedAt });
  const completed = await new BuddyJointActivityService(app.database).action("user_alice", "joint_1", "complete");
  assert.equal(completed.status, "completed");
  assert.equal(completed.occurredAt, completedAt, "report attribution uses terminal facts, not the later reconciliation read");
  const service = new BuddyMilestoneReportService(app.database);
  const first = await service.processBatch(new Date("2026-07-20T12:00:00.000Z"));
  assert.deepEqual(first, { relationships: 1, milestones: 3, reports: 2 });
  const second = await service.processBatch(new Date("2026-07-20T12:01:00.000Z"));
  assert.deepEqual(second, { relationships: 1, milestones: 0, reports: 0 });
  const milestones = await app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "buddy_milestone",
    relationshipId, limit: 20 });
  assert.deepEqual(milestones.map((item) => item.payload.rule_key).sort(),
    ["first_joint_action", "first_meaningful_interaction", "weekly_two_growth_actions"]);
  const reports = await app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "buddy_weekly_report",
    relationshipId, limit: 20 });
  assert.equal(reports.length, 2);
  assert.equal((reports[0]?.payload.content as any).weekly_active_growth_relationship, true);
  assert.equal((reports[0]?.payload.content as any).joint_actions, 1);
  const milestoneApi = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/milestones",
    headers: auth(alice), query: { relationship_id: relationshipId }, requestId: "milestone_list" } as never);
  const reportApi = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/weekly-reports",
    headers: auth(alice), query: { relationship_id: relationshipId }, requestId: "report_list" } as never);
  assert.equal(milestoneApi.statusCode, 200); assert.equal(milestoneApi.body.data.milestones.length, 3);
  assert.equal(reportApi.statusCode, 200); assert.equal(reportApi.body.data.reports.length, 1);
});

test("late verified events regenerate reports and current consent redacts partner content", async () => {
  const app = await runtime(); const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com"); const relationshipId = await acceptedRelationship(app, alice, bob);
  await insertAction(app, { id: "interaction_late_base", kind: "buddy_interaction", relationshipId,
    owner: "user_alice", status: "sent", at: "2026-07-15T10:00:00.000Z" });
  const service = new BuddyMilestoneReportService(app.database); const now = new Date("2026-07-20T12:00:00.000Z");
  await service.processBatch(now);
  await insertAction(app, { id: "late_verified", kind: "sleep_session", relationshipId,
    owner: "user_bob", status: "completed", at: "2026-07-16T10:00:00.000Z" });
  const regenerated = await service.processBatch(new Date("2026-07-20T13:00:00.000Z"));
  assert.equal(regenerated.reports, 2);
  const bobReports = (await service.listReports("user_bob", relationshipId)).reports;
  assert.equal(bobReports[0]?.version, 2);
  assert.ok((bobReports[0]?.content as any).partner);

  const grants = await app.database.listFrogSleepBuddySharingGrants("frogsleep", relationshipId);
  const grant = grants.find((item) => item.grantorUserId === "user_alice" && item.granteeUserId === "user_bob" &&
    item.category === "weekly_trend");
  assert.ok(grant);
  await app.database.updateFrogSleepBuddySharingGrant("frogsleep", grant.id, grant.version, "revoked");
  const redacted = await service.report("user_bob", String(bobReports[0]?.id));
  assert.equal(redacted.state, "redacted"); assert.equal("partner" in redacted.content, false);
});

test("worker uses per-viewer timezone and skips revoked relationships", async () => {
  const app = await runtime(); const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com"); const relationshipId = await acceptedRelationship(app, alice, bob);
  const timestamp = "2026-07-13T00:00:00.000Z";
  await app.database.upsertFrogSleepDevice({ id: "alice-device", appId: "frogsleep", userId: "user_alice",
    platform: "ios", pushToken: "alice-token", timezone: "Asia/Shanghai", pushEnabled: true,
    createdAt: timestamp, updatedAt: timestamp });
  await app.database.upsertFrogSleepDevice({ id: "bob-device", appId: "frogsleep", userId: "user_bob",
    platform: "ios", pushToken: "bob-token", timezone: "America/New_York", pushEnabled: true,
    createdAt: timestamp, updatedAt: timestamp });
  const service = new BuddyMilestoneReportService(app.database);
  await service.processBatch(new Date("2026-07-20T12:00:00.000Z"));
  const reports = await app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "buddy_weekly_report",
    relationshipId, limit: 10 });
  assert.deepEqual(new Set(reports.map((item) => item.payload.timezone)), new Set(["Asia/Shanghai", "America/New_York"]));
  for (const report of reports) {
    const content = report.payload.content as Record<string, unknown>;
    assert.equal((content.viewer as any).verified_progress, 0);
    assert.equal("failed" in content, false);
    assert.equal("ranking" in content, false);
    assert.equal(content.next_action, "choose_next_goal");
  }
  await service.processBatch(new Date("2026-03-09T12:00:00.000Z"));
  const springReports = await app.database.listFrogSleepEntities({ appId: "frogsleep", kind: "buddy_weekly_report",
    relationshipId, ownerUserId: "user_bob", limit: 20 });
  const spring = springReports.find(item => item.payload.window_end === "2026-03-09T04:00:00.000Z");
  assert.equal(spring?.payload.window_start, "2026-03-02T05:00:00.000Z", "DST weeks use local Mondays, not a fixed 168 hours");
  await app.database.updateFrogSleepEntity("sleep_relationship", "frogsleep", relationshipId,
    { status: "revoked", updatedAt: "2026-07-20T13:00:00.000Z" });
  const skipped = await service.processBatch(new Date("2026-07-20T14:00:00.000Z"));
  assert.equal(skipped.relationships, 0);
});


test("accepted invitations and arbitrary contribution receipts do not manufacture report progress", async () => {
  const app = await runtime(); const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com"); const relationshipId = await acceptedRelationship(app, alice, bob);
  await insertAction(app, { id: "not_completed", kind: "buddy_joint_activity", relationshipId,
    owner: "user_alice", status: "accepted", at: "2026-07-16T10:00:00.000Z" });
  await insertAction(app, { id: "untrusted_amount", kind: "buddy_goal_contribution", relationshipId,
    owner: "user_bob", status: "verified", at: "2026-07-16T10:00:00.000Z" });
  const service = new BuddyMilestoneReportService(app.database);
  const result = await service.processBatch(new Date("2026-07-20T12:00:00.000Z"));
  assert.equal(result.milestones, 0);
  const reports = await service.listReports("user_bob", relationshipId);
  const content = reports.reports[0]?.content as any;
  assert.equal(content.viewer.verified_progress, 0);
  assert.equal(content.joint_actions, 0);
  assert.equal(content.weekly_active_growth_relationship, false);
});


test("overlapping worker batches create one milestone and one report per viewer", async () => {
  const app = await runtime(); const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com"); const relationshipId = await acceptedRelationship(app, alice, bob);
  await insertAction(app, { id: "concurrent_encouragement", kind: "buddy_interaction", relationshipId,
    owner: "user_alice", status: "sent", at: "2026-07-16T10:00:00.000Z" });
  const service = new BuddyMilestoneReportService(app.database);
  const batches = await Promise.all(Array.from({ length: 3 }, () => service.processBatch(new Date("2026-07-20T12:00:00.000Z"))));
  assert.equal(batches.reduce((sum, result) => sum + result.milestones, 0), 1);
  assert.equal(batches.reduce((sum, result) => sum + result.reports, 0), 2);
});
