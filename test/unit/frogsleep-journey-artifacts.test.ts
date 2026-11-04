import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { latestAuthorizedSleepArtifact } from "../../src/modules/frogsleep/buddy-growth/buddy-artifact-redaction.ts";
import { BuddyConsentService } from "../../src/modules/frogsleep/buddy-growth/buddy-consent.service.ts";
import { findBuddyRelationship } from "../../src/modules/frogsleep/buddy-growth/buddy-relationship-facts.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
async function fixture(states?: Record<string, string>) {
  const database = new InMemoryDatabase(buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const now = new Date().toISOString(), id = "legacy_recap_pair";
  await database.insertFrogSleepBuddyDomainRelationship({ id, appId: "frogsleep", domain: "sleep",
    userIdLow: "user_alice", userIdHigh: "user_bob", status: "active", pausedByUserIds: [], version: 1, createdAt: now, updatedAt: now });
  for (const userId of ["user_alice", "user_bob"]) {
    const slot = await database.ensureFrogSleepBuddyDomainSlot({ appId: "frogsleep", userId, domain: "sleep", now });
    await database.compareAndUpdateFrogSleepBuddyDomainSlot({ appId: "frogsleep", userId, domain: "sleep",
      state: "occupied", relationshipId: id, expectedVersion: slot.version, updatedAt: now });
  }
  await new BuddyConsentService(database).replaceOwn("user_alice", id, "sleep", ["daily_summary"],
    { daily_summary: 0, presence: 0, shared_activity: 0, weekly_trend: 0 });
  await database.insertFrogSleepEntity({ id: "legacy_recap", appId: "frogsleep", kind: "night_recap",
    ownerUserId: "user_alice", partnerUserId: "user_bob", relationshipId: id, sessionId: "legacy_session",
    status: "ready", payload: { completed: true, participant_states: states, my_result_state: "completed",
      partner_result_state: "incomplete", date_anchor: "2026-10-10" }, createdAt: now, updatedAt: now });
  return { database, relationship: (await findBuddyRelationship(database, id))! };
}

test("old single-owner sleep recap is reprojected for the second viewer and rechecks consent", async () => {
  const { database, relationship } = await fixture({ user_alice: "morning_completed", user_bob: "sleeping" });
  const recap = await latestAuthorizedSleepArtifact(database, "user_bob", [relationship], "night_recap");
  assert.equal(recap?.my_result_state, "incomplete"); assert.equal(recap?.partner_result_state, "completed");
  assert.equal(recap?.combined_result_type, "partially_completed");
  await new BuddyConsentService(database).replaceOwn("user_alice", relationship.id, "sleep", [],
    { daily_summary: 1, presence: 0, shared_activity: 0, weekly_trend: 0 });
  assert.equal((await latestAuthorizedSleepArtifact(database, "user_bob", [relationship], "night_recap"))?.redacted, true);
});

test("old recap without viewer context is hidden rather than attributing the owner's completion", async () => {
  const { database, relationship } = await fixture();
  assert.deepEqual(await latestAuthorizedSleepArtifact(database, "user_bob", [relationship], "night_recap"), {
    artifact_type: "night_recap", redacted: true, unavailable_reason: "legacy_viewer_context_unavailable",
  });
});
