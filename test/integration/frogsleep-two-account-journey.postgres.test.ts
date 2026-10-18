import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import { BuddyDomainInvitationCommandService } from "../../src/modules/frogsleep/buddy-growth/buddy-domain-invitation-command.service.ts";
import { BuddyConsentService } from "../../src/modules/frogsleep/buddy-growth/buddy-consent.service.ts";
import { BuddyRelationshipLifecycleService } from "../../src/modules/frogsleep/buddy-growth/buddy-relationship-lifecycle.service.ts";
import { FrogSleepFocusBuddyService } from "../../src/modules/frogsleep/focus-buddy/focus-buddy.service.ts";
import { FrogSleepSleepBuddyService } from "../../src/modules/frogsleep/sleep-buddy/sleep-buddy.service.ts";

const url = process.env.FROGSLEEP_TEST_DATABASE_URL;
if (!url) throw new Error("FROGSLEEP_TEST_DATABASE_URL must refer to a disposable database.");
const now = () => new Date().toISOString();
async function connect(database: PostgresDatabase) {
  const timestamp = now();
  await database.upsertFrogSleepBuddyInvitationBundle({ id: "journey_invitation", appId: "frogsleep", inviterUserId: "user_alice",
    inviteeUserId: "user_bob", domains: ["sleep", "focus"], status: "pending", version: 1, domainInvitationIds: {}, domainErrorCodes: {},
    shareCode: "JOURNEY-PG", handoffToken: "journey-token", shareLink: "https://example.com/invite", locale: "zh-CN",
    expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: timestamp, updatedAt: timestamp });
  const relationships: Record<string, string> = {};
  for (const domain of ["sleep", "focus"] as const) {
    await database.upsertFrogSleepBuddyInvitationDomainDecision({ appId: "frogsleep", invitationId: "journey_invitation", domain,
      status: "pending", version: 1, createdAt: timestamp, updatedAt: timestamp });
    const receipt = await new BuddyDomainInvitationCommandService(database).accept("user_bob", "journey_invitation", domain,
      { expectedVersion: 1, idempotencyKey: `journey_${domain}` });
    relationships[domain] = receipt.relationship_id;
    for (const user of ["user_alice", "user_bob"]) await new BuddyConsentService(database).replaceOwn(user, receipt.relationship_id, domain,
      ["presence", "daily_summary", "weekly_trend", "shared_activity"], { presence: 0, daily_summary: 0, weekly_trend: 0, shared_activity: 0 });
  }
  return relationships;
}
const report = (id: string) => ({ session_id: id, status: "completed", room_id: "journey-room", planned_minutes: 25, actual_minutes: 25,
  started_at: "2026-10-11T10:00:00Z", ended_at: "2026-10-11T10:25:00Z" });

test("live PG two-account canonical journeys and optional companion failure", async suite => {
  const seed = buildDefaultSeed(new DevelopmentPasswordHasher(), { includeFrogSleep: true });
  const a = await PostgresDatabase.create(url, seed), b = await PostgresDatabase.create(url, seed);
  try {
    const rel = await connect(a), focusA = new FrogSleepFocusBuddyService(a), focusB = new FrogSleepFocusBuddyService(b);
    const sleepA = new FrogSleepSleepBuddyService(a), sleepB = new FrogSleepSleepBuddyService(b);
    await suite.test("simultaneous completions on independent connections produce one stable shared moment", async () => {
      await Promise.all([focusA.reportSession("user_alice", report("focus-a")), focusB.reportSession("user_bob", report("focus-b"))]);
      const momentsA = await focusA.sharedMoments("user_alice"), momentsB = await focusB.sharedMoments("user_bob");
      assert.equal(momentsA.moments.length, 1); assert.equal(momentsB.moments.length, 1);
      assert.equal(momentsA.moments[0].moment_id, momentsB.moments[0].moment_id);
      assert.equal(momentsA.moments[0].my_session_id, "focus-a"); assert.equal(momentsB.moments[0].my_session_id, "focus-b");
      await Promise.all([focusA.reportSession("user_alice", report("focus-a")), focusB.reportSession("user_bob", report("focus-b"))]);
      assert.equal((await focusA.sharedMoments("user_alice")).moments.length, 1);
      assert.equal((await focusA.weekStats("user_alice", "2026-10-05")).total_minutes, 25);
    });
    await suite.test("concurrent begin and morning acknowledgements commit one shared session and two viewer artifacts", async () => {
      const begins = await Promise.all([sleepA.beginSession("user_alice", rel.sleep, "2026-10-11"), sleepB.beginSession("user_bob", rel.sleep, "2026-10-11")]);
      assert.equal(begins[0].session_id, begins[1].session_id); const id = begins[0].session_id;
      await sleepB.acceptSession("user_bob", id);
      await Promise.all([sleepA.recordEvent("user_alice", id, "morning_completed"), sleepB.recordEvent("user_bob", id, "morning_completed")]);
      await Promise.all([sleepA.recordEvent("user_alice", id, "morning_completed"), sleepB.recordEvent("user_bob", id, "morning_completed")]);
      assert.equal((await a.findFrogSleepEntity("sleep_session", "frogsleep", id))?.status, "completed");
      assert.equal((await a.listFrogSleepEntities({ appId: "frogsleep", kind: "sleep_event", sessionId: id })).length, 2);
      for (const kind of ["sleep_summary", "night_recap"] as const) assert.equal((await b.listFrogSleepEntities({ appId: "frogsleep", kind, sessionId: id })).length, 2);
      assert.equal((await sleepA.latestRecap("user_alice"))?.combined_result_type, "both_completed");
      assert.equal((await sleepB.latestRecap("user_bob"))?.combined_result_type, "both_completed");
    });
    await suite.test("withdrawal or companion query failure cannot make committed private reporting fail", async () => {
      await new BuddyRelationshipLifecycleService(b).execute("user_bob", rel.focus, "pause", 1);
      await focusA.reportSession("user_alice", report("private-paused"));
      const original = a.listCurrentFrogSleepBuddyDomainRelationships.bind(a);
      a.listCurrentFrogSleepBuddyDomainRelationships = async () => { throw new Error("injected companion outage"); };
      try { const receipt = await focusA.reportSession("user_alice", report("private-outage")); assert.equal(receipt.id, "private-outage"); }
      finally { a.listCurrentFrogSleepBuddyDomainRelationships = original; }
      assert.equal((await focusA.sessions("user_alice")).sessions.length, 3);
      assert.equal((await focusB.sessions("user_bob")).sessions.length, 1);
    });
  } finally { await a.close(); await b.close(); }
});
