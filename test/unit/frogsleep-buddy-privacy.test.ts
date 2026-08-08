import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeBuddyOperationalMetadata,
  sanitizeBuddySafeRoute,
} from "../../src/modules/frogsleep/buddy-growth/buddy-privacy.ts";

test("buddy safe routes reject tokens, codes, summaries, notes, and raw records", () => {
  const value = sanitizeBuddySafeRoute({
    type: "buddy_invitation", invitation_id: "invite_1", domain: "sleep",
    token: "secret-token", code: "ABC123", private_summary: "slept badly",
    note: "private note", raw_record: { duration: 42 }, custom_text: "hello",
  });
  assert.deepEqual(value, {
    type: "buddy_invitation", invitation_id: "invite_1", domain: "sleep",
  });
});

test("buddy operational metadata keeps only opaque routing identifiers", () => {
  assert.deepEqual(sanitizeBuddyOperationalMetadata({
    relationship_id: "relationship_1", report_id: "report_1",
    sleep_score: 42, raw_health_data: [1, 2], note: "private",
  }), { relationship_id: "relationship_1", report_id: "report_1" });
});
