/** Independently deployable server capabilities for staged buddy-growth rollout. */
export interface BuddyGrowthCapabilities {
  invitationInbox: boolean;
  explicitInviteConsent: boolean;
  growthHub: boolean;
  structuredInteractions: boolean;
  goalsAndReports: boolean;
  pushDelivery: boolean;
}

export function resolveBuddyGrowthCapabilities(env: NodeJS.ProcessEnv = process.env): BuddyGrowthCapabilities {
  return {
    invitationInbox: enabled(env.FROGSLEEP_BUDDY_INBOX_ENABLED),
    explicitInviteConsent: enabled(env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED),
    growthHub: enabled(env.FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED),
    structuredInteractions: enabled(env.FROGSLEEP_BUDDY_INTERACTIONS_ENABLED),
    goalsAndReports: enabled(env.FROGSLEEP_BUDDY_GOALS_REPORTS_ENABLED),
    pushDelivery: enabled(env.FROGSLEEP_BUDDY_PUSH_ENABLED),
  };
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}
