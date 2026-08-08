import assert from "node:assert/strict";
import test from "node:test";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
import { createApplication } from "../../src/app.module.ts";
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
  return String(accepted.body.data.relationship_id);
}

async function insertAction(app: Awaited<ReturnType<typeof runtime>>, input: {
  id: string; kind: "buddy_interaction" | "buddy_joint_activity" | "buddy_goal_contribution";
  relationshipId: string; owner: string; status: string; at: string;
}) {
  await app.database.insertFrogSleepEntity({ id: input.id, appId: "frogsleep", kind: input.kind,
    ownerUserId: input.owner, partnerUserId: input.owner === "user_alice" ? "user_bob" : "user_alice",
    relationshipId: input.relationshipId, status: input.status, payload: { amount: 1 },
    occurredAt: input.at, createdAt: input.at, updatedAt: input.at });
}

test("worker deduplicates milestones and weekly reports while measuring meaningful activity", async () => {
  const app = await runtime(); const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com"); const relationshipId = await acceptedRelationship(app, alice, bob);
  await insertAction(app, { id: "interaction_1", kind: "buddy_interaction", relationshipId,
    owner: "user_alice", status: "sent", at: "2026-07-15T10:00:00.000Z" });
  await insertAction(app, { id: "joint_1", kind: "buddy_joint_activity", relationshipId,
    owner: "user_bob", status: "accepted", at: "2026-07-16T10:00:00.000Z" });
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
  await insertAction(app, { id: "late_verified", kind: "buddy_goal_contribution", relationshipId,
    owner: "user_bob", status: "verified", at: "2026-07-16T10:00:00.000Z" });
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
  await app.database.updateFrogSleepEntity("sleep_relationship", "frogsleep", relationshipId,
    { status: "revoked", updatedAt: "2026-07-20T13:00:00.000Z" });
  const skipped = await service.processBatch(new Date("2026-07-20T14:00:00.000Z"));
  assert.equal(skipped.relationships, 0);
});
