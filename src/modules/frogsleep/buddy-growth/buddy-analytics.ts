import type { AnalyticsService } from "../../analytics/analytics.service.ts";
import type { StructuredLogger } from "../../../infrastructure/logging/pino-logger.module.ts";
import { emitFrogSleepAnalyticsEvent } from "../frogsleep-analytics.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buddyFunnelMetadata } from "./buddy-governance.ts";

export const buddyFunnelEvents = [
  "invitation_created", "invitation_delivered", "invitation_previewed", "invitation_accepted",
  "invitation_declined", "first_interaction", "first_joint_action", "weekly_active_growth",
  "notification_delivered", "notification_failed", "push_opt_out", "relationship_paused",
  "relationship_revoked", "user_blocked", "user_reported", "complaint_recorded",
] as const;

export type BuddyFunnelStage = typeof buddyFunnelEvents[number];

/** Emits one privacy-safe buddy funnel or safety event. */
export async function emitBuddyFunnelEvent(input: {
  analyticsService?: AnalyticsService;
  logger?: StructuredLogger;
  userId: string;
  stage: BuddyFunnelStage;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await emitFrogSleepAnalyticsEvent(input, {
    name: `frogsleep_buddy_${input.stage}`,
    appId: FROGSLEEP_APP_ID,
    userId: input.userId,
    metadata: buddyFunnelMetadata(input.metadata ?? {}),
  });
}
