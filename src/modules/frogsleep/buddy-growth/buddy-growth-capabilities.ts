/** Independently deployable server capabilities for staged buddy-growth rollout. */
export interface BuddyGrowthCapabilities {
  invitationInbox: boolean;
  explicitInviteConsent: boolean;
  growthHub: boolean;
  structuredInteractions: boolean;
  goalsAndReports: boolean;
  pushDelivery: boolean;
  emailDelivery: boolean;
  /** Stranger-matching for focus buddy (search/dismiss/report). Off by default for v1 launch (invite-only). */
  focusMatching: boolean;
  /** Group (multi-person) buddy support (2-5 people). Off by default for v1 launch (1-on-1 only). */
  groupBuddies: boolean;
}

export function resolveBuddyGrowthCapabilities(env: NodeJS.ProcessEnv = process.env): BuddyGrowthCapabilities {
  const inviteOnlyDefaultsEnabled = env.DEPLOY_SLOT?.trim().toLowerCase() === "dev";
  return {
    invitationInbox: enabled(env.FROGSLEEP_BUDDY_INBOX_ENABLED, inviteOnlyDefaultsEnabled),
    explicitInviteConsent: enabled(env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED, inviteOnlyDefaultsEnabled),
    growthHub: enabled(env.FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED, inviteOnlyDefaultsEnabled),
    structuredInteractions: enabled(env.FROGSLEEP_BUDDY_INTERACTIONS_ENABLED, inviteOnlyDefaultsEnabled),
    goalsAndReports: enabled(env.FROGSLEEP_BUDDY_GOALS_REPORTS_ENABLED, inviteOnlyDefaultsEnabled),
    pushDelivery: enabled(env.FROGSLEEP_BUDDY_PUSH_ENABLED, inviteOnlyDefaultsEnabled),
    emailDelivery: enabled(env.FROGSLEEP_BUDDY_EMAIL_ENABLED, inviteOnlyDefaultsEnabled),
    focusMatching: enabled(env.FROGSLEEP_BUDDY_FOCUS_MATCHING_ENABLED),
    groupBuddies: enabled(env.FROGSLEEP_BUDDY_GROUP_ENABLED),
  };
}

function enabled(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined) return defaultValue;
  return value.trim().toLowerCase() === "true";
}
