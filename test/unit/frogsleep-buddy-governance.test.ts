import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buddyFunnelMetadata, buddyRetentionDays, evaluateBuddyRollout } from
  "../../src/modules/frogsleep/buddy-growth/buddy-governance.ts";
import { buddyFunnelEvents } from "../../src/modules/frogsleep/buddy-growth/buddy-analytics.ts";

test("buddy funnel metadata keeps opaque route identifiers only", () => {
  assert.deepEqual(buddyFunnelMetadata({ relationship_id: "rel", invitation_id: "inv",
    token: "secret", note: "private", summary: { sleep: 8 } }),
  { relationship_id: "rel", invitation_id: "inv" });
});

test("analytics taxonomy spans conversion retention delivery and safety", () => {
  for (const stage of ["invitation_created", "invitation_delivered", "invitation_previewed",
    "invitation_accepted", "first_interaction", "first_joint_action", "weekly_active_growth",
    "push_opt_out", "relationship_revoked", "user_blocked", "user_reported", "complaint_recorded"])
    assert.equal(buddyFunnelEvents.includes(stage as never), true);
});

test("guardrail breach disables prompts and escalates safety regressions", () => {
  assert.deepEqual(evaluateBuddyRollout({ push_opt_out_rate: 0.16 }).disabledCapabilities,
    ["prompts", "push"]);
  assert.deepEqual(evaluateBuddyRollout({ complaint_rate: 0.006 }).disabledCapabilities,
    ["prompts", "push", "growth"]);
  assert.equal(evaluateBuddyRollout({ revoke_rate: 0.01 }).enabled, true);
});

test("retention migration and policy cover every derived buddy resource", async () => {
  const sql = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/013_frogsleep_buddy_governance.sql", import.meta.url), "utf8");
  for (const resource of ["notification_deliveries", "notifications", "shares", "interactions",
    "invitation_receipts"]) assert.match(sql, new RegExp(resource));
  assert.equal(buddyRetentionDays.auditRecord, 730);
  assert.match(sql, /frogsleep_purge_expired_buddy_data/);
  assert.match(sql, /Rollback:/);
});

test("security review covers required threat classes", async () => {
  const review = await readFile(new URL("../../docs/frogsleep-buddy-security-review.md", import.meta.url), "utf8");
  for (const threat of ["enumeration", "guessing", "Replay", "IDOR", "leakage", "races", "evasion"])
    assert.match(review, new RegExp(threat, "i"));
});

test("bilateral block and directional authorization guard every buddy surface", async () => {
  const files = await Promise.all([
    "focus-buddy/focus-buddy.service.ts", "focus-buddy/focus-buddy-invites.ts",
    "sleep-buddy/sleep-buddy.service.ts", "sleep-buddy/sleep-buddy-invites.ts",
    "buddy-growth/buddy-growth-hub.service.ts", "buddy-growth/buddy-joint-goal.service.ts",
    "buddy-growth/buddy-milestone-report.service.ts", "buddy-growth/buddy-notification-worker.service.ts",
  ].map((path) => readFile(new URL(`../../src/modules/frogsleep/${path}`, import.meta.url), "utf8")));
  const source = files.join("\n");
  for (const guard of ["assertBuddyPairNotBlocked", "assertBuddyDataAuthorized",
    "authorizedFocusMessageRelationshipIds", "assertAuthorized"])
    assert.match(source, new RegExp(guard));
});
