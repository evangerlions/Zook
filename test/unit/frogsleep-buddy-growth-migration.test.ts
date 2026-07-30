import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../src/infrastructure/database/postgres/migrations/007_frogsleep_buddy_growth.sql",
  import.meta.url,
);

test("buddy growth migration defines grants, invite projections, and notification outbox", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  for (const table of [
    "zook_frogsleep_buddy_sharing_grants",
    "zook_frogsleep_buddy_invitation_bundles",
    "zook_frogsleep_buddy_invitation_receipts",
    "zook_frogsleep_buddy_notification_outbox",
    "zook_frogsleep_buddy_notifications",
    "zook_frogsleep_buddy_notification_deliveries",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }

  assert.match(sql, /UNIQUE \(app_id, relationship_id, grantor_user_id, grantee_user_id, domain, category\)/);
  assert.match(sql, /UNIQUE \(app_id, deduplication_key\)/);
  assert.match(sql, /CHECK \(version > 0\)/);
  assert.match(sql, /idx_frogsleep_buddy_invitation_receipts_inbox/);
  assert.match(sql, /idx_frogsleep_buddy_notifications_unread/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION frogsleep_transition_buddy_invitation/);
  assert.match(sql, /current_version <> expected_version/);
});

test("legacy relationship migration backfills bilateral category grants idempotently", async () => {
  const sql = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/009_frogsleep_buddy_legacy_grant_backfill.sql", import.meta.url), "utf8");
  assert.match(sql, /zook_frogsleep_sleep_relationships/);
  assert.match(sql, /zook_frogsleep_focus_relationships/);
  assert.match(sql, /'presence'.*'daily_summary'.*'weekly_trend'.*'shared_activity'/s);
  assert.match(sql, /ON CONFLICT[\s\S]*DO NOTHING/);
  assert.match(sql, /legacy-/);
});

test("P1 growth activity migration creates isolated share, interaction, and joint activity tables", async () => {
  const sql = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/010_frogsleep_buddy_growth_activity.sql", import.meta.url), "utf8");
  for (const table of ["zook_frogsleep_buddy_shares", "zook_frogsleep_buddy_interactions",
    "zook_frogsleep_buddy_joint_activities"]) assert.match(sql, new RegExp(table));
  assert.match(sql, /relationship_id, created_at DESC/);
  assert.match(sql, /relationship_id, status, created_at DESC/);
});

test("bundle coordination migration stores child outcomes and idempotent response state", async () => {
  const sql = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/008_frogsleep_buddy_invitation_bundle_coordination.sql", import.meta.url), "utf8");
  for (const column of ["domain_invitation_ids", "domain_error_codes", "last_idempotency_key", "response_payload"]) {
    assert.match(sql, new RegExp(column));
  }
});

test("domain decision migration creates a constrained per-invitation fact table", async () => {
  const sql = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/013_frogsleep_buddy_invitation_domain_decisions.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_invitation_domain_decisions/);
  assert.match(sql, /UNIQUE \(app_id, invitation_id, domain\)/);
  assert.match(sql, /CHECK \(domain IN \('sleep', 'focus'\)\)/);
  assert.match(sql, /CHECK \(status IN \('pending', 'accepted', 'declined', 'cancelled', 'expired'\)\)/);
  assert.match(sql, /CHECK \(version >= 1\)/);
  assert.match(sql, /idx_frogsleep_buddy_invitation_domain_decisions_invitation/);
});

test("receipt attempt migration stores only recipient-bound opaque facts", async () => {
  const sql = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/014_frogsleep_buddy_invitation_receipt_attempts.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_invitation_receipt_attempts/);
  assert.match(sql, /recipient_identity_hash TEXT NOT NULL CHECK \(recipient_identity_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(sql, /UNIQUE \(app_id, inviter_user_id, recipient_identity_hash, domains_fingerprint\)/);
  assert.match(sql, /CHECK \(status IN \('recorded', 'decoy'\)\)/);
  assert.match(sql, /idx_frogsleep_buddy_invitation_receipt_attempts_outbox/);
  assert.doesNotMatch(sql, /\bemail\b|locator|idempotency|token|body/i);
});

test("canonical invitation migration projects live sleep and focus invites and installs email outbox", async () => {
  const sql = await readFile(new URL(
    "../../src/infrastructure/database/postgres/migrations/017_frogsleep_buddy_canonical_invitation_email.sql",
    import.meta.url,
  ), "utf8");
  assert.match(sql, /zook_frogsleep_buddy_invitation_email_deliveries/);
  assert.match(sql, /zook_frogsleep_buddy_invitation_email_attempts/);
  assert.match(sql, /FROM zook_frogsleep_sleep_invites/);
  assert.match(sql, /FROM zook_frogsleep_focus_invites/);
  assert.match(sql, /'legacy_' \|\| domain \|\| '_' \|\| id/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
  assert.match(sql, /JSONB_BUILD_OBJECT\('bundle_id', bundle.id\)/);
  assert.match(sql, /zook_frogsleep_buddy_invitation_domain_decisions/);
});

test("P2 migration stores goals, verified contributions, milestones, and viewer reports", async () => {
  const sql = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/011_frogsleep_buddy_goals_reports.sql", import.meta.url), "utf8");
  for (const table of ["zook_frogsleep_buddy_joint_goals", "zook_frogsleep_buddy_goal_contributions",
    "zook_frogsleep_buddy_milestones", "zook_frogsleep_buddy_weekly_reports"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /idempotency_key/);
  assert.match(sql, /source_event_id/);
  assert.match(sql, /rule_key.*window_key/);
  assert.match(sql, /window_start.*version/);
  assert.match(sql, /timezone source/);
  assert.match(sql, /Rollback:/);
});

test("P3 governance migration defines bounded purge and retention indexes", async () => {
  const sql = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/012_frogsleep_buddy_governance.sql", import.meta.url), "utf8");
  assert.match(sql, /frogsleep_purge_expired_buddy_data/);
  assert.match(sql, /interval '30 days'/);
  assert.match(sql, /interval '90 days'/);
  assert.match(sql, /retention/);
});
