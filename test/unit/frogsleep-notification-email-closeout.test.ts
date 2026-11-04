import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { BuddyInvitationEmailWorkerService } from "../../src/modules/frogsleep/buddy-growth/buddy-invitation-email-worker.service.ts";
import { BuddyNotificationPreferenceService } from "../../src/modules/frogsleep/buddy-growth/buddy-notification-preference.service.ts";
import { ApplicationError } from "../../src/shared/errors.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
async function fixture() {
  process.env.FROGSLEEP_BUDDY_EMAIL_ENABLED = "true";
  const runtime = await createApplication({ frogsleepEnabled: true, queueBackend: "memory", databaseFactory: seed => new InMemoryDatabase(seed) });
  const logged = await runtime.app.handle({ method: "POST", path: "/api/v1/frogsleep/auth/password/login", headers: {}, body: { account: "alice@example.com", password: "Password1234" } } as never);
  const created = await runtime.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/invitations",
    headers: { authorization: `Bearer ${logged.body.data.access_token}` }, body: { target: { email: "bob@example.com" }, domains: ["sleep"] } } as never);
  assert.equal(created.statusCode, 200);
  const id = String(created.body.data.invitation_id);
  return { database: runtime.database, id };
}

test("email retries honor capability, bound-recipient disabled category and terminated invitation", async () => {
  for (const changed of ["disabled", "category", "terminal"]) {
    const f = await fixture(); let calls = 0;
    const worker = new BuddyInvitationEmailWorkerService(f.database, { async send() { calls += 1; throw new ApplicationError(503, "EMAIL_PROVIDER_REQUEST_FAILED", "outage"); } });
    await worker.processBatch(); const row = (await f.database.findFrogSleepBuddyInvitationEmailDelivery("frogsleep", f.id))!;
    await f.database.updateFrogSleepBuddyInvitationEmailDelivery(row.id, { availableAt: new Date(0).toISOString() });
    if (changed === "disabled") process.env.FROGSLEEP_BUDDY_EMAIL_ENABLED = "false";
    if (changed === "category") await new BuddyNotificationPreferenceService(f.database).update("user_bob", { disabled_categories: ["invitations"] });
    if (changed === "terminal") await f.database.upsertFrogSleepBuddyInvitationBundle({ ...(await f.database.findFrogSleepBuddyInvitationBundle("frogsleep", f.id))!, status: "cancelled" });
    await worker.processBatch(); assert.equal(calls, 1, changed);
    assert.equal((await f.database.findFrogSleepBuddyInvitationEmailDelivery("frogsleep", f.id))?.status, "suppressed");
  }
});

test("email provider acceptance is retained without claiming delivery or resending after duplicate ticks", async () => {
  const f = await fixture(); let calls = 0;
  const worker = new BuddyInvitationEmailWorkerService(f.database, { async send() { calls += 1; return { provider: "tencent_ses", messageId: "message", requestId: "request" }; } });
  await Promise.all([worker.processBatch(), worker.processBatch()]); await worker.processBatch();
  const row = await f.database.findFrogSleepBuddyInvitationEmailDelivery("frogsleep", f.id);
  assert.equal(calls, 1); assert.equal(row?.status, "provider_accepted"); assert.equal(row?.deliveredAt, undefined);
});

test("stale processing and transport outcome unknown do not blindly resend an email", async () => {
  const f = await fixture(); let calls = 0;
  const row = (await f.database.findFrogSleepBuddyInvitationEmailDelivery("frogsleep", f.id))!;
  await f.database.updateFrogSleepBuddyInvitationEmailDelivery(row.id, { status: "processing", attemptCount: 1, updatedAt: new Date(0).toISOString() });
  const worker = new BuddyInvitationEmailWorkerService(f.database, { async send() { calls += 1; throw new TypeError("response lost"); } });
  await worker.processBatch(); assert.equal(calls, 0);
  assert.equal((await f.database.findFrogSleepBuddyInvitationEmailDelivery("frogsleep", f.id))?.lastErrorCode, "PROVIDER_OUTCOME_UNKNOWN");
  await f.database.updateFrogSleepBuddyInvitationEmailDelivery(row.id, { status: "queued", availableAt: new Date(0).toISOString() });
  await worker.processBatch(); await worker.processBatch(); assert.equal(calls, 1);
  assert.equal((await f.database.findFrogSleepBuddyInvitationEmailDelivery("frogsleep", f.id))?.status, "dead_letter");
});

test("permanent email provider configuration failure is not retried", async () => {
  const f = await fixture(); let calls = 0;
  const worker = new BuddyInvitationEmailWorkerService(f.database, { async send() { calls += 1; throw new ApplicationError(503, "EMAIL_SERVICE_NOT_CONFIGURED", "missing config"); } });
  await worker.processBatch(); await worker.processBatch(); assert.equal(calls, 1);
  assert.equal((await f.database.findFrogSleepBuddyInvitationEmailDelivery("frogsleep", f.id))?.status, "dead_letter");
});
