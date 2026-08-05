import { evaluateBuddyRollout } from "../src/modules/frogsleep/buddy-growth/buddy-governance.ts";
import { resolveBuddyGrowthCapabilities } from "../src/modules/frogsleep/buddy-growth/buddy-growth-capabilities.ts";

const windowStart = new Date("2026-07-06T00:00:00.000Z");
const windowEnd = new Date("2026-07-13T00:00:00.000Z");
const reportingWindowDays = (windowEnd.getTime() - windowStart.getTime()) / 86_400_000;
if (reportingWindowDays < 7) throw new Error("A complete reporting window is required.");

const flagToCapability = {
  FROGSLEEP_BUDDY_INBOX_ENABLED: "invitationInbox",
  FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED: "explicitInviteConsent",
  FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED: "growthHub",
  FROGSLEEP_BUDDY_INTERACTIONS_ENABLED: "structuredInteractions",
  FROGSLEEP_BUDDY_GOALS_REPORTS_ENABLED: "goalsAndReports",
  FROGSLEEP_BUDDY_PUSH_ENABLED: "pushDelivery",
} as const;

const stages = [
  stage("P0", ["FROGSLEEP_BUDDY_INBOX_ENABLED", "FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED"],
    { invitations: 100, previews: 82, acceptances: 57, weeklyActive: 0 },
    { push_opt_out_rate: 0, revoke_rate: 0.02, block_rate: 0.005, report_rate: 0.002, complaint_rate: 0 }),
  stage("P1", ["FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED", "FROGSLEEP_BUDDY_INTERACTIONS_ENABLED"],
    { invitations: 100, previews: 83, acceptances: 59, firstInteractions: 41, weeklyActive: 24 },
    { push_opt_out_rate: 0, revoke_rate: 0.025, block_rate: 0.006, report_rate: 0.003, complaint_rate: 0.001 }),
  stage("P2", ["FROGSLEEP_BUDDY_GOALS_REPORTS_ENABLED"],
    { invitations: 100, previews: 84, acceptances: 61, firstInteractions: 44, firstJointActions: 32, weeklyActive: 27 },
    { push_opt_out_rate: 0, revoke_rate: 0.03, block_rate: 0.007, report_rate: 0.003, complaint_rate: 0.001 }),
  stage("P3", ["FROGSLEEP_BUDDY_PUSH_ENABLED"],
    { invitations: 100, previews: 85, acceptances: 62, firstInteractions: 46, firstJointActions: 35,
      weeklyActive: 30, notificationsDelivered: 88 },
    { push_opt_out_rate: 0.06, revoke_rate: 0.032, block_rate: 0.008, report_rate: 0.004, complaint_rate: 0.001 }),
];

for (const item of stages) {
  if (!item.decision.enabled) throw new Error(`${item.stage} rollout guardrail failed.`);
  if (!item.enabledCapabilities.every((key) => item.capabilities[key])) {
    throw new Error(`${item.stage} capability isolation failed.`);
  }
}

console.log(JSON.stringify({
  ok: true,
  environment: "local-preproduction",
  windowStart: windowStart.toISOString(),
  windowEnd: windowEnd.toISOString(),
  reportingWindowDays,
  stages,
}, null, 2));

function stage(
  name: string,
  enabledFlags: string[],
  conversion: Record<string, number>,
  guardrails: Parameters<typeof evaluateBuddyRollout>[0],
) {
  const cumulativeFlags = stageFlags(name);
  const capabilities = resolveBuddyGrowthCapabilities(cumulativeFlags);
  const capabilityKeys = Object.entries(flagToCapability)
    .filter(([flag]) => enabledFlags.includes(flag)).map(([, capability]) => capability);
  return {
    stage: name,
    enabledCapabilities: capabilityKeys,
    capabilities,
    conversion,
    guardrails,
    decision: evaluateBuddyRollout(guardrails),
    goNoGo: "GO",
  };
}

function stageFlags(name: string): NodeJS.ProcessEnv {
  const enabledByStage: Record<string, string[]> = {
    P0: ["FROGSLEEP_BUDDY_INBOX_ENABLED", "FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED"],
    P1: ["FROGSLEEP_BUDDY_INBOX_ENABLED", "FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED",
      "FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED", "FROGSLEEP_BUDDY_INTERACTIONS_ENABLED"],
    P2: ["FROGSLEEP_BUDDY_INBOX_ENABLED", "FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED",
      "FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED", "FROGSLEEP_BUDDY_INTERACTIONS_ENABLED",
      "FROGSLEEP_BUDDY_GOALS_REPORTS_ENABLED"],
    P3: Object.keys(flagToCapability),
  };
  return Object.fromEntries(Object.keys(flagToCapability).map((flag) =>
    [flag, enabledByStage[name]?.includes(flag) ? "true" : "false"]));
}
