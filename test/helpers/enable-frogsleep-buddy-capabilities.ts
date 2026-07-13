/** Enables every buddy-growth capability for API and worker integration tests. */
export function enableFrogSleepBuddyCapabilities(): void {
  process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_INTERACTIONS_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_GOALS_REPORTS_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_PUSH_ENABLED = "true";
}
