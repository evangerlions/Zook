import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { ApplicationError } from "../../src/shared/errors.ts";
import { BuddyInvitationEmailWorkerService } from "../../src/modules/frogsleep/buddy-growth/buddy-invitation-email-worker.service.ts";
import { TENCENT_SES_CALLBACK_TOKEN_PASSWORD_KEY } from "../../src/services/tencent-ses-email-callback.service.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();

async function runtime() {
  return await createApplication({
    frogsleepEnabled: true,
    queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed),
  });
}

async function login(app: Awaited<ReturnType<typeof runtime>>, account: string) {
  const response = await app.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/auth/password/login",
    headers: {},
    body: { account, password: "Password1234" },
    requestId: `login_${account}`,
  } as never);
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

test("email invitation can be claimed after the recipient account email becomes available", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const created = await app.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/buddy/invitations",
    headers: auth(alice),
    body: { target: { email: " Future@example.com " }, domains: ["sleep", "focus"] },
    requestId: "future_email_create",
  } as never);

  assert.equal(created.statusCode, 200);
  assert.match(String(created.body.data.share_code), /^[A-HJ-NP-Z2-9]{8}$/);
  assert.match(String(created.body.data.share_link), /^https:\/\//);
  assert.equal(created.body.data.delivery.status, "queued");
  const invitationId = String(created.body.data.invitation_id);
  assert.equal(app.database.auditLogs.some((item) =>
    item.action === "frogsleep_buddy_invitation_created"
    && item.resourceId === invitationId
    && !JSON.stringify(item.payload).includes("future@example.com")), true);
  const stored = await app.database.findFrogSleepBuddyInvitationBundle("frogsleep", invitationId);
  assert.equal(stored?.inviteeUserId, undefined);
  assert.deepEqual(stored?.domainInvitationIds, {});

  await app.database.updateUserEmail("user_bob", "future@example.com");
  const bob = await login(app, "future@example.com");
  const preview = await app.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/buddy/invitations/preview",
    query: { code: ` ${String(created.body.data.share_code).toLowerCase()} ` },
    headers: auth(bob),
    requestId: "future_email_preview",
  } as never);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.data.invitation_id, invitationId);
  assert.equal(preview.body.data.viewer_can_accept, true);
  assert.deepEqual(preview.body.data.viewer_actions, ["preview", "accept", "decline"]);
  assert.equal(preview.body.data.delivery, undefined);

  const accepted = await app.app.handle({
    method: "POST",
    path: `/api/v1/frogsleep/buddy/invitations/${invitationId}/accept`,
    headers: auth(bob),
    body: {
      expected_version: 1,
      idempotency_key: "future_email_accept_once",
      sharing_categories: ["presence", "daily_summary"],
    },
    requestId: "future_email_accept",
  } as never);
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(
    accepted.body.data.results.map((item: { status: string }) => item.status),
    ["sleep", "focus"].map(() => "accepted"),
  );
  assert.equal(
    (await app.database.findFrogSleepBuddyInvitationBundle("frogsleep", invitationId))?.inviteeUserId,
    "user_bob",
  );
  assert.equal(app.database.auditLogs.some((item) =>
    item.action === "frogsleep_buddy_invitation_accept"
    && item.resourceId === invitationId), true);

  for (const kind of ["sleep_relationship", "focus_relationship"] as const) {
    const relationships = await app.database.listFrogSleepEntities({
      appId: "frogsleep",
      kind,
      ownerUserId: "user_alice",
    });
    assert.equal(relationships.length, 1);
    assert.equal(relationships[0]?.partnerUserId, "user_bob");
  }
});

test("invitation email worker records provider acceptance and exposes truthful delivery status", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const created = await app.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/buddy/invitations",
    headers: auth(alice),
    body: { target: { email: "bob@example.com" }, domains: ["sleep"] },
    requestId: "delivery_create",
  } as never);
  const invitationId = String(created.body.data.invitation_id);
  const worker = new BuddyInvitationEmailWorkerService(app.database, {
    async send(command) {
      assert.equal(command.recipientEmail, "bob@example.com");
      assert.equal(command.invitation.shareLink.includes(command.invitation.handoffToken), true);
      return {
        provider: "tencent_ses",
        requestId: "ses_request_1",
        messageId: "ses_message_1",
      };
    },
  });

  assert.deepEqual(await worker.processBatch(), { processed: 1, failed: 0 });
  assert.deepEqual(await worker.processBatch(), { processed: 0, failed: 0 });
  const delivery = await app.database.findFrogSleepBuddyInvitationEmailDelivery(
    "frogsleep",
    invitationId,
  );
  assert.equal(delivery?.status, "provider_accepted");
  assert.equal(delivery?.providerMessageId, "ses_message_1");
  assert.equal(
    (await app.database.listFrogSleepBuddyInvitationEmailAttempts("frogsleep", delivery!.id))[0]?.status,
    "provider_accepted",
  );
  await app.services.commonPasswordConfigService.set(
    TENCENT_SES_CALLBACK_TOKEN_PASSWORD_KEY,
    "Buddy invitation callback test",
    "buddy-callback-token",
  );
  const callback = await app.app.handle({
    method: "POST",
    path: "/api/v1/email/tencent/callback",
    query: { token: "buddy-callback-token" },
    headers: {},
    body: {
      event: "delivered",
      eventid: 1,
      email: "bob@example.com",
      timestamp: Math.floor(Date.now() / 1000),
      messageId: "ses_message_1",
    },
    requestId: "delivery_callback",
  } as never);
  assert.equal(callback.statusCode, 200);

  const status = await app.app.handle({
    method: "GET",
    path: `/api/v1/frogsleep/buddy/invitations/${invitationId}/delivery`,
    headers: auth(alice),
    requestId: "delivery_status",
  } as never);
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.data.delivery.status, "delivered");

  const bob = await login(app, "bob@example.com");
  const recipientStatus = await app.app.handle({
    method: "GET",
    path: `/api/v1/frogsleep/buddy/invitations/${invitationId}/delivery`,
    headers: auth(bob),
    requestId: "delivery_status_recipient",
  } as never);
  assert.equal(recipientStatus.statusCode, 404);
});

test("concurrent invitation email workers claim one delivery only once", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  await app.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/buddy/invitations",
    headers: auth(alice),
    body: { target: "bob@example.com", domains: ["sleep"] },
    requestId: "concurrent_delivery_create",
  } as never);
  let sends = 0;
  const sender = {
    async send() {
      sends += 1;
      await Promise.resolve();
      return {
        provider: "tencent_ses" as const,
        requestId: "concurrent_request",
        messageId: "concurrent_message",
      };
    },
  };
  const first = new BuddyInvitationEmailWorkerService(app.database, sender);
  const second = new BuddyInvitationEmailWorkerService(app.database, sender);

  const outcomes = await Promise.all([first.processBatch(), second.processBatch()]);

  assert.equal(sends, 1);
  assert.deepEqual(
    outcomes.sort((left, right) => right.processed - left.processed),
    [{ processed: 1, failed: 0 }, { processed: 0, failed: 0 }],
  );
});

test("invitation email worker retries transient failures and dead-letters the bounded final attempt", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const created = await app.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/buddy/invitations",
    headers: auth(alice),
    body: { target: "bob@example.com", domains: ["sleep"] },
    requestId: "retry_create",
  } as never);
  const invitationId = String(created.body.data.invitation_id);
  const worker = new BuddyInvitationEmailWorkerService(app.database, {
    async send() {
      throw new Error("transient provider outage");
    },
  });

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.deepEqual(await worker.processBatch(), { processed: 0, failed: 1 });
    const current = await app.database.findFrogSleepBuddyInvitationEmailDelivery(
      "frogsleep",
      invitationId,
    );
    assert.equal(current?.status, attempt < 5 ? "retryable_failed" : "dead_letter");
    if (attempt < 5) {
      await app.database.updateFrogSleepBuddyInvitationEmailDelivery(current!.id, {
        availableAt: new Date(0).toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }
  const delivery = await app.database.findFrogSleepBuddyInvitationEmailDelivery(
    "frogsleep",
    invitationId,
  );
  assert.equal(
    (await app.database.listFrogSleepBuddyInvitationEmailAttempts("frogsleep", delivery!.id)).length,
    5,
  );
});

test("recipient mismatch cannot preview or claim an unbound email invitation", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const created = await app.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/buddy/invitations",
    headers: auth(alice),
    body: { target: { email: "someone-else@example.com" }, domains: ["sleep"] },
    requestId: "mismatch_create",
  } as never);
  const preview = await app.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/buddy/invitations/preview",
    query: { token: String(created.body.data.share_link).split("token=")[1] },
    headers: auth(bob),
    requestId: "mismatch_preview",
  } as never);
  assert.equal(preview.statusCode, 404);
  assert.equal(
    (await app.database.findFrogSleepBuddyInvitationBundle(
      "frogsleep",
      String(created.body.data.invitation_id),
    ))?.inviteeUserId,
    undefined,
  );
});

test("concurrent recipient claims materialize one relationship and idempotent replay is safe", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const created = await app.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/buddy/invitations",
    headers: auth(alice),
    body: { target: { email: "bob@example.com" }, domains: ["sleep"] },
    requestId: "concurrent_create",
  } as never);
  const invitationId = String(created.body.data.invitation_id);
  const request = (key: string) => app.app.handle({
    method: "POST",
    path: `/api/v1/frogsleep/buddy/invitations/${invitationId}/accept`,
    headers: auth(bob),
    body: { expected_version: 1, idempotency_key: key, sharing_categories: ["presence"] },
    requestId: `concurrent_${key}`,
  } as never);

  const [first, second] = await Promise.all([request("claim_a"), request("claim_b")]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
  const relationship = await app.database.listFrogSleepEntities({
    appId: "frogsleep", kind: "sleep_relationship", ownerUserId: "user_alice",
  });
  assert.equal(relationship.length, 1);

  const replay = await app.app.handle({
    method: "POST",
    path: `/api/v1/frogsleep/buddy/invitations/${invitationId}/accept`,
    headers: auth(bob),
    body: { expected_version: 1, idempotency_key: "claim_a", sharing_categories: ["presence"] },
    requestId: "concurrent_replay",
  } as never);
  if (first.statusCode === 200) assert.equal(replay.statusCode, 200);
});

test("permanent email configuration failure dead-letters once without invalidating the invitation", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const created = await app.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/buddy/invitations",
    headers: auth(alice),
    body: { target: "bob@example.com", domains: ["focus"] },
    requestId: "missing_email_config_create",
  } as never);
  const worker = new BuddyInvitationEmailWorkerService(app.database, {
    async send() {
      throw new ApplicationError(503, "EMAIL_SERVICE_NOT_CONFIGURED", "Email is unavailable.");
    },
  });

  assert.deepEqual(await worker.processBatch(), { processed: 0, failed: 1 });
  assert.deepEqual(await worker.processBatch(), { processed: 0, failed: 0 });
  const delivery = await app.database.findFrogSleepBuddyInvitationEmailDelivery(
    "frogsleep", String(created.body.data.invitation_id),
  );
  assert.equal(delivery?.status, "dead_letter");
  assert.equal(delivery?.attemptCount, 1);

  const preview = await app.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/buddy/invitations/preview",
    query: { code: String(created.body.data.share_code) },
    headers: auth(bob),
    requestId: "missing_email_config_preview",
  } as never);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.data.viewer_can_accept, true);
});

test("canonical HTTPS handoff is secret-minimal, browser-safe, and records an opaque open audit", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const created = await app.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/buddy/invitations",
    headers: auth(alice),
    body: { target: "bob@example.com", domains: ["sleep"] },
    requestId: "handoff_create",
  } as never);
  const token = new URL(String(created.body.data.share_link)).searchParams.get("token")!;
  const handoff = await app.app.handle({
    method: "GET",
    path: "/frogsleep/buddy-invitation",
    query: { token },
    headers: {},
    requestId: "handoff_open",
  } as never);
  assert.equal(handoff.statusCode, 200);
  assert.equal(handoff.contentType, "text/html; charset=utf-8");
  let html = "";
  for await (const chunk of handoff.streamBody!) html += chunk;
  assert.match(html, /frogsleep:\/\/buddy-invitation/);
  assert.doesNotMatch(html, /alice@example|bob@example|share_code/i);
  assert.equal(
    app.database.auditLogs.some((item) =>
      item.action === "frogsleep_buddy_invitation_handoff_opened"
      && item.resourceId === created.body.data.invitation_id),
    true,
  );
});

test("admin delivery diagnostics are authenticated, read-only, and mask recipient identity", async () => {
  const app = await createApplication({
    frogsleepEnabled: true,
    queueBackend: "memory",
    adminBasicAuth: { username: "admin", password: "AdminPass123!" },
    databaseFactory: (seed) => new InMemoryDatabase(seed),
  });
  const alice = await login(app, "alice@example.com");
  const created = await app.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/buddy/invitations",
    headers: auth(alice),
    body: { target: "bob@example.com", domains: ["sleep"] },
    requestId: "admin_delivery_create",
  } as never);
  const path = "/api/v1/admin/apps/frogsleep/buddy-invitation-deliveries";
  const unauthorized = await app.app.handle({
    method: "GET", path, headers: {}, requestId: "admin_delivery_unauthorized",
  } as never);
  assert.equal(unauthorized.statusCode, 401);

  const response = await app.app.handle({
    method: "GET", path,
    query: { invitation_id: String(created.body.data.invitation_id) },
    headers: {
      authorization: `Basic ${Buffer.from("admin:AdminPass123!").toString("base64")}`,
    },
    requestId: "admin_delivery_list",
  } as never);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.items.length, 1);
  assert.match(response.body.data.items[0].recipient_masked, /^bo\*\*\*@/);
  assert.equal(JSON.stringify(response.body.data).includes("bob@example.com"), false);
  assert.equal(app.database.auditLogs.some((item) =>
    item.action === "admin.buddy_invitation_delivery.read"), true);

  const invalidLimit = await app.app.handle({
    method: "GET", path,
    query: { limit: "not-a-number" },
    headers: {
      authorization: `Basic ${Buffer.from("admin:AdminPass123!").toString("base64")}`,
    },
    requestId: "admin_delivery_invalid_limit",
  } as never);
  assert.equal(invalidLimit.statusCode, 400);
});
