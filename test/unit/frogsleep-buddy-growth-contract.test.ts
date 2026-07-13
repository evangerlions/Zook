import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buddyGoalTypes,
  buddyInteractionTypes,
  buddyInvitationActions,
  buddyInvitationDirections,
  buddyInvitationDomains,
  buddyInvitationStatuses,
  buddyNotificationTypes,
  buddyReportStates,
  buddySharingCategories,
  legacyInviteDomain,
} from "../../src/modules/frogsleep/buddy-growth/buddy-growth-contract.ts";
import { resolveBuddyGrowthCapabilities } from "../../src/modules/frogsleep/buddy-growth/buddy-growth-capabilities.ts";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

const capabilityFlags = [
  "FROGSLEEP_BUDDY_INBOX_ENABLED",
  "FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED",
  "FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED",
  "FROGSLEEP_BUDDY_INTERACTIONS_ENABLED",
  "FROGSLEEP_BUDDY_GOALS_REPORTS_ENABLED",
  "FROGSLEEP_BUDDY_PUSH_ENABLED",
] as const;

test("buddy growth canonical vocabulary remains stable", () => {
  assert.deepEqual(buddyInvitationDomains, ["sleep", "focus", "bundle"]);
  assert.deepEqual(buddyInvitationDirections, ["incoming", "outgoing"]);
  assert.deepEqual(buddyInvitationStatuses, ["pending", "accepted", "declined", "cancelled", "expired"]);
  assert.equal(buddyInvitationActions.includes("preview"), true);
  assert.equal(buddySharingCategories.includes("weekly_trend"), true);
  assert.equal(buddyInteractionTypes.includes("tonight_together"), true);
  assert.equal(buddyNotificationTypes.includes("weekly_report_ready"), true);
  assert.equal(buddyGoalTypes.includes("focus_minutes"), true);
  assert.equal(buddyReportStates.includes("redacted"), true);
  assert.equal(legacyInviteDomain("sleep_invite"), "sleep");
  assert.equal(legacyInviteDomain("focus_invite"), "focus");
});

test("buddy growth capabilities default off and enable independently", () => {
  assert.deepEqual(resolveBuddyGrowthCapabilities({}), {
    invitationInbox: false,
    explicitInviteConsent: false,
    growthHub: false,
    structuredInteractions: false,
    goalsAndReports: false,
    pushDelivery: false,
  });
  assert.equal(resolveBuddyGrowthCapabilities({ FROGSLEEP_BUDDY_INBOX_ENABLED: "true" }).invitationInbox, true);
  assert.equal(resolveBuddyGrowthCapabilities({ FROGSLEEP_BUDDY_PUSH_ENABLED: "TRUE" }).pushDelivery, true);
});

test("buddy growth routes are unreachable until their capability is enabled", async () => {
  const previous = Object.fromEntries(capabilityFlags.map((flag) => [flag, process.env[flag]]));
  try {
    capabilityFlags.forEach((flag) => delete process.env[flag]);
    const disabled = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
      databaseFactory: (seed) => new InMemoryDatabase(seed) });
    const response = await disabled.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy/hub",
      headers: {}, requestId: "disabled_buddy_hub" } as never);
    assert.equal(response.statusCode, 404);
  } finally {
    capabilityFlags.forEach((flag) => {
      const value = previous[flag];
      if (value === undefined) delete process.env[flag]; else process.env[flag] = value;
    });
  }
});

test("buddy growth contract fixtures cover locked baseline cases", async () => {
  const source = await readFile(new URL("../fixtures/frogsleep-buddy-growth/invitation-contract-cases.json", import.meta.url), "utf8");
  const fixtures = JSON.parse(source) as Record<string, unknown>;
  for (const key of [
    "sleep_only", "focus_only", "bundled", "multiple_pending", "expired", "cancelled",
    "unauthorized", "blocked", "asymmetric_consent", "same_person_dual_domain", "different_person_dual_domain",
  ]) {
    assert.ok(fixtures[key], `missing fixture ${key}`);
  }
});
