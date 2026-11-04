import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";
import { createApplication } from "../../src/app.module.ts";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import { buildFrogSleepNotificationPayload } from "../../src/modules/frogsleep/frogsleep-notifications.ts";
import { FrogSleepProductDataService } from "../../src/modules/frogsleep/product-data/frogsleep-product-data.service.ts";
import { FrogSleepSleepBuddyService } from "../../src/modules/frogsleep/sleep-buddy/sleep-buddy.service.ts";
import { BuddyNotificationPreferenceService } from "../../src/modules/frogsleep/buddy-growth/buddy-notification-preference.service.ts";
import { NotificationService, type PushDispatchRequest } from "../../src/services/notification.service.ts";
import { FailedEventRetryService } from "../../src/services/failed-event-retry.service.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

const databaseUrl = process.env.FROGSLEEP_TEST_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("FROGSLEEP_TEST_DATABASE_URL is required and must point to a disposable PostgreSQL database.");
}
enableFrogSleepBuddyCapabilities();
const appId = "frogsleep";
const runId = `sleep_loop_${randomUUID().replaceAll("-", "")}`;
type Runtime = Awaited<ReturnType<typeof createApplication>>;
type Actor = { id: string; token: string; email: string };
type Context = { runtime: Runtime; database: PostgresDatabase; sql: Client; alice: Actor; bob: Actor; charlie: Actor; dana: Actor };

async function request(runtime: Runtime, token: string, method: string, path: string, body?: unknown) {
  return await runtime.app.handle({ method, path: `/api/v1/frogsleep${path}`, body,
    headers: { authorization: `Bearer ${token}` }, requestId: runId } as never);
}

async function actor(runtime: Runtime, name: string): Promise<Actor> {
  const id = `${runId}_${name}`, email = `${id}@example.test`;
  await runtime.database.insertUser({ id, email, passwordHash: "unused", passwordAlgo: "test",
    status: "ACTIVE", createdAt: new Date().toISOString() });
  await runtime.services.appRegistryService.ensureMembership(appId, id);
  const session = await runtime.services.authService.issueSession(id, appId);
  return { id, email, token: session.accessToken };
}

async function acceptedRelationship(runtime: Runtime, owner: Actor, partner: Actor) {
  const created = await request(runtime, owner.token, "POST", "/buddy/invitations",
    { target: { email: partner.email }, domains: ["sleep"] });
  assert.equal(created.statusCode, 200);
  const invitationId = String(created.body.data.invitation_id);
  const accepted = await request(runtime, partner.token, "POST", `/buddy/invitations/${invitationId}/domains/sleep/accept`,
    { expected_version: 1, idempotency_key: `${runId}_${invitationId}` });
  assert.equal(accepted.statusCode, 200);
  return String(accepted.body.data.relationship_id);
}

async function enableSharing(runtime: Runtime, relationshipId: string, owner: Actor) {
  const listed = await request(runtime, owner.token, "GET", `/buddy/relationships/${relationshipId}/grants`);
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.data.grants.length, 8);
  const ownGrants = listed.body.data.grants.filter((grant: { grantor_user_id: string }) => grant.grantor_user_id === owner.id);
  assert.equal(ownGrants.length, 4);
  for (const grant of ownGrants) {
    assert.equal(grant.state, "revoked");
    const updated = await request(runtime, owner.token, "PATCH", `/buddy/relationships/${relationshipId}/grants/${grant.id}`,
      { expected_version: grant.version, state: "granted" });
    assert.equal(updated.statusCode, 200);
  }
}

async function sessionMorning(context: Context, relationshipId: string) {
  const { runtime, alice, bob } = context;
  const started = await request(runtime, alice.token, "POST", "/sleep-buddy/shared-sessions",
    { relationship_id: relationshipId, date_anchor: "2026-10-18" });
  assert.equal(started.statusCode, 200);
  const sessionId = String(started.body.data.session_id);
  const accepted = await request(runtime, bob.token, "POST", `/sleep-buddy/shared-sessions/${sessionId}/accept`);
  assert.equal(accepted.statusCode, 200);
  for (const eventType of ["interrupted", "returned", "morning_completed"]) {
    const recorded = await request(runtime, alice.token, "POST", `/sleep-buddy/shared-sessions/${sessionId}/events`,
      { event_type: eventType });
    assert.equal(recorded.statusCode, 200);
    assert.equal(recorded.body.data.status, "active", "one participant cannot finish the shared session for both");
  }
  const partnerMorning = await request(runtime, bob.token, "POST", `/sleep-buddy/shared-sessions/${sessionId}/events`,
    { event_type: "morning_completed" });
  assert.equal(partnerMorning.statusCode, 200);
  assert.equal(partnerMorning.body.data.status, "completed");
  const summary = await request(runtime, bob.token, "GET", "/sleep-buddy/shared-summaries/latest");
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.body.data.summary.relationship_id, relationshipId);
  assert.equal(summary.body.data.summary.session_id, sessionId);
  assert.equal(summary.body.data.summary.had_recovery, true);
  return sessionId;
}

async function relationshipLifecycle(context: Context, relationshipId: string, sessionId: string) {
  const { runtime, database, alice, bob } = context;
  const action = (user: Actor, verb: string) => request(runtime, user.token, "POST", `/sleep-buddy/relationships/${relationshipId}/${verb}`);
  assert.equal((await action(alice, "pause")).body.data.relationship.status, "paused");
  assert.equal((await action(bob, "pause")).body.data.relationship.status, "paused");
  const duringPause = await request(runtime, alice.token, "POST", "/sleep-buddy/shared-sessions", { relationship_id: relationshipId });
  assert.equal(duringPause.statusCode, 409);
  assert.equal((await action(alice, "resume")).body.data.relationship.status, "paused");
  assert.equal((await request(runtime, bob.token, "GET", "/sleep-buddy/shared-summaries/latest")).body.data.summary, null);
  assert.equal((await action(bob, "resume")).body.data.relationship.status, "active");
  assert.equal((await action(alice, "revoke")).body.data.relationship.status, "revoked");
  const afterRevoke = await request(runtime, bob.token, "POST", `/sleep-buddy/shared-sessions/${sessionId}/events`, { event_type: "returned" });
  assert.equal(afterRevoke.statusCode, 403);
  for (const user of [alice, bob]) {
    assert.equal((await database.findFrogSleepBuddyDomainSlot(appId, user.id, "sleep"))?.state, "available");
  }
  const replacedId = await acceptedRelationship(runtime, alice, bob);
  assert.notEqual(replacedId, relationshipId, "released slots must admit a new invitation");
}

async function invitationThroughMorning(context: Context) {
  const { runtime, database, alice, bob } = context;
  const id = await acceptedRelationship(runtime, alice, bob);
  const current = await request(runtime, alice.token, "GET", "/sleep-buddy/relationships/current");
  assert.equal(current.statusCode, 200);
  assert.equal(current.body.data.relationship.relationship_id, id);
  const grants = await database.listFrogSleepBuddySharingGrants(appId, id);
  assert.equal(grants.length, 8);
  assert.ok(grants.every((grant) => grant.state === "revoked"));
  const status = await request(runtime, alice.token, "GET", "/sleep-buddy/guardianship/status");
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.data.current_relationship.relationship_id, id);
  assert.equal(status.body.data.active_session, null);
  await rejectForeignRelationship(context, id);
  const denied = await request(runtime, alice.token, "POST", "/sleep-buddy/shared-sessions", { relationship_id: id });
  assert.equal(denied.statusCode, 403);
  await enableSharing(runtime, id, alice);
  await enableSharing(runtime, id, bob);
  const sessionId = await sessionMorning(context, id);
  await relationshipLifecycle(context, id, sessionId);
}

async function rejectForeignRelationship(context: Context, id: string) {
  const { runtime, charlie, database } = context;
  for (const [method, path, body] of [
    ["POST", "/sleep-buddy/shared-sessions", { relationship_id: id }],
    ["POST", `/sleep-buddy/relationships/${id}/pause`, undefined],
    ["PATCH", `/sleep-buddy/relationships/${id}/preferences`, { mute_for_tonight: true }],
  ] as const) {
    assert.equal((await request(runtime, charlie.token, method, path, body)).statusCode, 403);
  }
  assert.equal((await database.findFrogSleepBuddyDomainRelationship(appId, id))?.status, "active");
}

async function rejectWrongDomain(context: Context) {
  const { database, runtime, charlie, dana } = context;
  const [userIdLow, userIdHigh] = [charlie.id, dana.id].sort();
  const id = `${runId}_focus_relation`, now = new Date().toISOString();
  await database.insertFrogSleepBuddyDomainRelationship({ id, appId, domain: "focus", userIdLow, userIdHigh,
    status: "active", pausedByUserIds: [], version: 1, createdAt: now, updatedAt: now });
  for (const [method, path, body] of [
    ["POST", "/sleep-buddy/shared-sessions", { relationship_id: id }],
    ["POST", `/sleep-buddy/relationships/${id}/revoke`, undefined],
    ["PATCH", `/sleep-buddy/relationships/${id}/preferences`, { mute_for_tonight: true }],
  ] as const) {
    assert.equal((await request(runtime, charlie.token, method, path, body)).statusCode, 403);
  }
  assert.equal((await database.findFrogSleepBuddyDomainRelationship(appId, id))?.status, "active");
}

async function seedReports(sql: Client, owner: string, prefix: string, count: number, microseconds = false) {
  await sql.query(`INSERT INTO zook_frogsleep_personal_sync_state(app_id,user_id)
    VALUES($1,$2) ON CONFLICT DO NOTHING`, [appId, owner]);
  await sql.query(`WITH advanced AS (
      UPDATE zook_frogsleep_personal_sync_state SET sequence=sequence+$4
      WHERE app_id=$2 AND user_id=$3 RETURNING sequence-$4 AS base
    ), reports AS (
      SELECT $1 || lpad(series::text,4,'0') AS id, series, base+series AS sequence,
        to_char(('2026-10-18T01:02:03.123000Z'::timestamptz +
          (CASE WHEN $5::boolean THEN series ELSE 0 END) * interval '1 microsecond') AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at
      FROM advanced, generate_series(1,$4::int) AS series
    ) INSERT INTO zook_frogsleep_personal_versions(app_id,user_id,kind,resource_id,sequence,document)
    SELECT $2,$3,'sleep_report',id,sequence,jsonb_build_object(
      'kind','sleep_report','id',id,'revision',1,'sequence',sequence,'deleted',false,
      'created_at',recorded_at,'updated_at',recorded_at,'data',jsonb_build_object(
        'snapshot_id',id,'report_id',id,'schema_version','1','recorded_at',recorded_at,
        'data',jsonb_build_object('night',series))) FROM reports`, [prefix, appId, owner, count, microseconds]);
}

async function allReports(service: FrogSleepProductDataService, owner: string) {
  const reports: Record<string, unknown>[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let index = 0; index < 30; index += 1) {
    const page = await service.listSleepReports(owner, { limit: 100, cursor });
    assert.ok(page.sleep_reports.length <= 100);
    reports.push(...page.sleep_reports);
    if (!page.pagination.has_more) {
      assert.equal(page.pagination.next_cursor, null);
      return reports;
    }
    assert.ok(page.pagination.next_cursor);
    assert.equal(cursors.has(page.pagination.next_cursor), false, "cursor must advance");
    cursors.add(page.pagination.next_cursor);
    cursor = page.pagination.next_cursor;
  }
  assert.fail("history pagination did not terminate");
}

async function completeHistory(context: Context) {
  const { database, sql, alice, bob, dana } = context;
  const prefix = `${runId}_report_`;
  await seedReports(sql, alice.id, prefix, 1100);
  const service = new FrogSleepProductDataService(database);
  await service.createSleepReport(bob.id, { snapshot_id: `${runId}_private`, schema_version: "1",
    recorded_at: "2027-01-01T00:00:00.000Z", data: { private: true } });
  const restored = await allReports(service, alice.id);
  const ids = restored.map((report) => String(report.snapshot_id));
  const expected = Array.from({ length: 1100 }, (_, index) => `${prefix}${String(index + 1).padStart(4, "0")}`);
  assert.equal(ids.length, 1100);
  assert.equal(new Set(ids).size, 1100);
  assert.deepEqual(new Set(ids), new Set(expected));
  assert.deepEqual((await allReports(service, bob.id)).map((report) => report.snapshot_id), [`${runId}_private`]);
  assert.deepEqual(await allReports(service, dana.id), []);
  await assert.rejects(allReports(service, `${runId}_nobody`), { statusCode: 403 });
}

async function microsecondHistory(context: Context) {
  const { database, sql, charlie } = context;
  const prefix = `${runId}_microsecond_`;
  await seedReports(sql, charlie.id, prefix, 301, true);
  const reports = await allReports(new FrogSleepProductDataService(database), charlie.id);
  assert.equal(reports.length, 301, "PostgreSQL submillisecond timestamps must not lose records at a JS millisecond cursor boundary");
  const expected = Array.from({ length: 301 }, (_, index) => `${prefix}${String(index + 1).padStart(4, "0")}`);
  assert.deepEqual(new Set(reports.map((report) => report.snapshot_id)), new Set(expected));
  assert.equal(reports[0].recorded_at, "2026-10-18T01:02:03.123301Z");
  assert.equal(reports.at(-1)?.recorded_at, "2026-10-18T01:02:03.123001Z");
}

async function notificationFixture(context: Context) {
  const { runtime, database, charlie, dana } = context;
  const relationshipId = await acceptedRelationship(runtime, charlie, dana);
  await enableSharing(runtime, relationshipId, charlie);
  await enableSharing(runtime, relationshipId, dana);
  await new BuddyNotificationPreferenceService(database).update(dana.id,
    { quiet_start_minute: 0, quiet_end_minute: 0, cooldown_minutes: 0, daily_budget: 100 });
  const queue = new InMemoryJobQueue(), delivered: PushDispatchRequest[] = [];
  const logger = new StructuredLogger("postgres-loop-test", { emitToConsole: false });
  const notifications = new NotificationService(database, queue, logger,
    { async dispatch(request) { delivered.push(request); } });
  const sleep = new FrogSleepSleepBuddyService(database, notifications);
  const session = await sleep.beginSession(charlie.id, relationshipId);
  const sessionId = String(session.session_id);
  await sleep.acceptSession(dana.id, sessionId);
  assert.equal(queue.jobs.length, 1);
  const noDeviceJobId = String(queue.jobs[0].payload.notificationJobId);
  await queue.processDueJobs((job) => notifications.processQueueJob(job));
  const noDeviceJob = await database.findNotificationJob(noDeviceJobId);
  assert.equal(noDeviceJob?.status, "SENT");
  assert.equal((noDeviceJob?.payload._frogsleep_delivery as { outcome: string }).outcome, "NO_ACTIVE_DEVICES");
  const now = new Date().toISOString();
  await database.upsertFrogSleepDevice({ id: `${dana.id}_device`, appId, userId: dana.id, platform: "ios",
    pushToken: "test-only-no-external-provider", pushEnabled: true, createdAt: now, updatedAt: now });
  return { relationshipId, sessionId, queue, delivered, notifications, sleep, logger };
}

async function notificationPreferences(context: Context) {
  const fixture = await notificationFixture(context);
  const { database, charlie, dana } = context;
  await fixture.sleep.recordEvent(charlie.id, fixture.sessionId, "interrupted");
  assert.equal(fixture.queue.jobs.length, 1);
  const queuedId = String(fixture.queue.jobs[0].payload.notificationJobId);
  await fixture.sleep.updatePreferences(dana.id, fixture.relationshipId, { allow_recovery_nudges: false });
  await fixture.queue.processDueJobs((job) => fixture.notifications.processQueueJob(job));
  assert.equal(fixture.delivered.length, 0);
  const suppressed = await database.findNotificationJob(queuedId);
  assert.equal(suppressed?.status, "SENT");
  assert.equal((suppressed?.payload._frogsleep_delivery as { outcome: string }).outcome, "RECOVERY_PUSH_DISABLED");
  await fixture.sleep.updatePreferences(dana.id, fixture.relationshipId, { allow_recovery_nudges: true });
  await fixture.sleep.recordEvent(charlie.id, fixture.sessionId, "returned");
  await fixture.queue.processDueJobs((job) => fixture.notifications.processQueueJob(job));
  assert.deepEqual(fixture.delivered.map((item) => item.payload.type), ["shared_session_returned"]);
  await fixture.sleep.updatePreferences(dana.id, fixture.relationshipId, { allow_morning_summary_push: false });
  await fixture.sleep.recordEvent(charlie.id, fixture.sessionId, "morning_completed");
  assert.equal(fixture.queue.jobs.length, 0);
  await unavailableProvider(context, fixture.logger);
}

async function unavailableProvider(context: Context, logger: StructuredLogger) {
  const queue = new InMemoryJobQueue();
  const service = new NotificationService(context.database, queue, logger);
  const now = new Date().toISOString();
  await context.database.insertFrogSleepEntity({ id: `${runId}_invite`, appId, kind: "sleep_invite",
    ownerUserId: context.charlie.id, partnerUserId: context.dana.id, status: "pending", payload: {}, createdAt: now, updatedAt: now });
  const queued = await service.queueNotification({ appId, recipientUserId: context.dana.id, channel: "push",
    payload: buildFrogSleepNotificationPayload({ type: "sleep_buddy_invite", entityId: `${runId}_invite` }) });
  await queue.processDueJobs((job) => service.processQueueJob(job));
  const failedJob = await context.database.findNotificationJob(queued.notificationJobId);
  assert.equal(failedJob?.status, "FAILED");
  assert.equal((failedJob?.payload._frogsleep_delivery as { outcome: string }).outcome, "retryable_failed");
  const failed = await context.database.listFailedEvents(appId);
  assert.ok(queue.jobs.length > 0 || failed.some((event) => event.payload.notificationJobId === queued.notificationJobId && event.nextRetryAt));
  await restoredProvider(context, queue, logger, queued.notificationJobId);
}

async function restoredProvider(context: Context, queue: InMemoryJobQueue, logger: StructuredLogger, notificationJobId: string) {
  const sent: PushDispatchRequest[] = [];
  const retry = new FailedEventRetryService(context.database, queue, logger);
  const result = await retry.retryDueEvents(new Date(Date.now() + 120_000));
  assert.ok(result.replayed >= 1, "provider failure must be replayable from persisted failed_events");
  const recovered = new NotificationService(context.database, queue, logger,
    { async dispatch(request) { sent.push(request); } });
  await queue.processDueJobs((job) => recovered.processQueueJob(job));
  const deliveredJob = await context.database.findNotificationJob(notificationJobId);
  assert.equal(deliveredJob?.status, "SENT");
  assert.equal((deliveredJob?.payload._frogsleep_delivery as { outcome: string }).outcome, "PROVIDER_ACCEPTED");
  assert.ok(sent.some((request) => request.userId === context.dana.id && request.pushToken === "test-only-no-external-provider"));
  assert.equal((await context.database.listFailedEvents(appId)).some((event) => event.payload.notificationJobId === notificationJobId), false);
}

async function queuedSharingRevocation(context: Context) {
  for (const scenario of [{ category: "shared_activity", event: "interrupted" }, { category: "daily_summary", event: "morning_completed" }]) {
    const [charlie, dana] = await Promise.all([
      actor(context.runtime, `eric_${scenario.category}`), actor(context.runtime, `fiona_${scenario.category}`),
    ]);
    const isolated = { ...context, charlie, dana };
    const fixture = await notificationFixture(isolated);
    await suppressAfterGrantRevocation(isolated, fixture, scenario);
  }
}

async function suppressAfterGrantRevocation(context: Context, fixture: Awaited<ReturnType<typeof notificationFixture>>,
  scenario: { category: string; event: string }) {
  const { runtime, database, charlie, dana } = context;
  fixture.delivered.length = 0;
  const grants = await database.listFrogSleepBuddySharingGrants(appId, fixture.relationshipId);
  const grant = grants.find((item) => item.grantorUserId === charlie.id && item.granteeUserId === dana.id && item.category === scenario.category);
  assert.ok(grant);
  await fixture.sleep.recordEvent(charlie.id, fixture.sessionId, scenario.event);
  assert.equal(fixture.queue.jobs.length, 1);
  const id = String(fixture.queue.jobs[0].payload.notificationJobId);
  const grantPath = `/buddy/relationships/${fixture.relationshipId}/grants/${grant.id}`;
  const revoked = await request(runtime, charlie.token, "PATCH", grantPath, { expected_version: grant.version, state: "revoked" });
  assert.equal(revoked.statusCode, 200);
  await fixture.queue.processDueJobs((job) => fixture.notifications.processQueueJob(job));
  assert.equal(fixture.delivered.length, 0, `worker must honor the sender's latest ${scenario.category} sharing revocation`);
  const suppressed = await database.findNotificationJob(id);
  assert.equal(suppressed?.status, "SENT");
  assert.equal((suppressed?.payload._frogsleep_delivery as { outcome: string }).outcome,
    scenario.category === "shared_activity" ? "TARGET_UNAVAILABLE" : "TARGET_UNAUTHORIZED");
  const restored = await request(runtime, charlie.token, "PATCH", grantPath, { expected_version: grant.version + 1, state: "granted" });
  assert.equal(restored.statusCode, 200);
  if (scenario.category === "shared_activity") {
    assert.equal((await database.findFrogSleepEntity("sleep_session", appId, fixture.sessionId))?.status, "cancelled",
      "restoring sharing must not reactivate the cancelled session");
  }
}

async function waitForSlotWaiters(sql: Client, minimum: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await sql.query(`SELECT COUNT(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock'
        AND query LIKE '%zook_frogsleep_buddy_domain_slots%'`);
    if (result.rows[0].count >= minimum) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail(`expected ${minimum} blocked runtime slot commands before releasing SQL barrier`);
}

async function concurrentBeginAndRevoke(context: Context) {
  const { runtime, database, sql } = context;
  const [left, right] = await Promise.all([actor(runtime, "race_left"), actor(runtime, "race_right")]);
  const id = await acceptedRelationship(runtime, left, right);
  await enableSharing(runtime, id, left);
  await enableSharing(runtime, id, right);
  const blocker = new Client({ connectionString: databaseUrl });
  await blocker.connect();
  const pending: Promise<unknown>[] = [];
  try {
    await blocker.query("BEGIN");
    await blocker.query(`SELECT user_id FROM zook_frogsleep_buddy_domain_slots
      WHERE app_id=$1 AND user_id=ANY($2::text[]) AND domain='sleep' ORDER BY user_id FOR UPDATE`, [appId, [left.id, right.id]]);
    await raceLockedCommands(context, blocker, pending, left, right, id);
    assert.deepEqual(await database.listFrogSleepEntities({ appId, kind: "sleep_session", relationshipId: id }), []);
    assert.equal((await database.findFrogSleepBuddyDomainRelationship(appId, id))?.status, "revoked");
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    await Promise.allSettled(pending);
    await blocker.end();
  }
}

async function raceLockedCommands(context: Context, blocker: Client, pending: Promise<unknown>[], left: Actor, right: Actor, id: string) {
  const service = new FrogSleepSleepBuddyService(context.database);
  const revoked = service.relationshipAction(left.id, id, "revoke");
  pending.push(revoked);
  await waitForSlotWaiters(context.sql, 1);
  const started = service.beginSession(right.id, id).then(() => 200, (error: { statusCode?: number }) => error.statusCode);
  pending.push(started);
  await Promise.race([waitForSlotWaiters(context.sql, 2), started.then(() => assert.fail("begin escaped the lifecycle slot lock"))]);
  await blocker.query("COMMIT");
  const [relationship, beginStatus] = await Promise.all([revoked, started]);
  assert.equal(relationship.status, "revoked");
  assert.equal(beginStatus, 409);
}

test("PostgreSQL FrogSleep backend business loops", async (suite) => {
  const seed = buildDefaultSeed(new DevelopmentPasswordHasher(), { includeFrogSleep: true });
  const database = await PostgresDatabase.create(databaseUrl, seed);
  const sql = new Client({ connectionString: databaseUrl });
  await sql.connect();
  const runtime = await createApplication({ frogsleepEnabled: true, queueBackend: "memory", database });
  assert.equal(runtime.database instanceof InMemoryDatabase, false, "integration must exercise real PostgreSQL storage");
  try {
    const [alice, bob, charlie, dana] = await Promise.all(["alice", "bob", "charlie", "dana"].map((name) => actor(runtime, name)));
    const context = { runtime, database, sql, alice, bob, charlie, dana };
    await suite.test("new domain invitation reaches authorized morning result and bilateral lifecycle", () => invitationThroughMorning(context));
    await suite.test("more than 500 reports with equal timestamps restore fully and isolate owners", () => completeHistory(context));
    await suite.test("microsecond SQL timestamps retain every report across page boundaries", () => microsecondHistory(context));
    await suite.test("worker rechecks preferences and provider readiness against persisted state", () => notificationPreferences(context));
    await suite.test("queued sleep pushes respect directional sharing revocation before delivery", () => queuedSharingRevocation(context));
    await suite.test("focus relationship IDs cannot operate sleep runtime", () => rejectWrongDomain(context));
    await suite.test("begin waits behind a concurrent revoke and cannot create a late session", () => concurrentBeginAndRevoke(context));
  } finally {
    await runtime.close();
    await sql.end();
  }
});
