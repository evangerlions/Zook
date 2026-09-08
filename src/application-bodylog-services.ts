import type { ApplicationDatabase } from "./infrastructure/database/application-database.ts";
import type { StructuredLogger } from "./infrastructure/logging/pino-logger.module.ts";
import { resolveBodyLogStores } from "./application-bodylog-stores.ts";
import { BodyLogProfileService } from "./modules/bodylog/bodylog-profile.service.ts";
import { BodyLogSocialService } from "./modules/bodylog/bodylog-social.service.ts";
import { BodyLogLeaderboardService } from "./modules/bodylog/bodylog-leaderboard.service.ts";
import { BodyLogInvitationService } from "./modules/bodylog/bodylog-invitation.service.ts";
import { BodyLogChallengeService } from "./modules/bodylog/bodylog-challenge.service.ts";
import { BodyLogBuddyService } from "./modules/bodylog/bodylog-buddy.service.ts";
import { BodyLogGroupService } from "./modules/bodylog/bodylog-group.service.ts";
import { BodyLogWorkerService } from "./modules/bodylog/bodylog-worker.service.ts";
import { BodyLogGrowthService } from "./modules/bodylog/bodylog-growth.service.ts";
import { BodyLogNotificationService } from "./modules/bodylog/bodylog-notification.service.ts";
import { BodyLogFeatureFlagService } from "./modules/bodylog/bodylog-feature-flag.service.ts";
import type { ContentSafetyService } from "./services/content-safety.service.ts";
import type { NotificationService } from "./services/notification.service.ts";
import { SubscriptionService } from "./services/subscription.service.ts";
import { withBodyLogExecution } from "./modules/bodylog/bodylog-execution.ts";

/**
 * Builds all BodyLog module services. Store-backed domains (buddy/group/
 * growth/notification/feature-flag/subscription) receive narrow store ports
 * resolved by resolveBodyLogStores; the rest keep the full database.
 * Mirrors createFrogSleepWorkerServices so application-factory stays lean.
 */
export function createBodyLogServices(input: {
  database: ApplicationDatabase;
  contentSafetyService: ContentSafetyService;
  notificationService?: NotificationService;
  logger: StructuredLogger;
}) {
  const { database, contentSafetyService, notificationService, logger } = input;
  const stores = resolveBodyLogStores(database);
  const execute = <T>(operation: () => Promise<T>) => database.withExclusiveSession(operation);
  const bodyLogProfileService = new BodyLogProfileService(database, contentSafetyService);
  const bodyLogSocialService = new BodyLogSocialService(database, bodyLogProfileService);
  const bodyLogLeaderboardService = new BodyLogLeaderboardService(database, bodyLogProfileService);
  const bodyLogInvitationService = new BodyLogInvitationService(database);
  const bodyLogChallengeService = new BodyLogChallengeService(database, bodyLogProfileService);
  const bodyLogGrowthService = withBodyLogExecution(new BodyLogGrowthService(stores.growth), execute);
  const bodyLogNotificationService = withBodyLogExecution(new BodyLogNotificationService(stores.notification), execute);
  const bodyLogFeatureFlagService = new BodyLogFeatureFlagService(stores.flags);
  const subscriptionService = new SubscriptionService(stores.subscription);
  const bodyLogBuddyService = withBodyLogExecution(new BodyLogBuddyService(stores.buddy, database, notificationService, subscriptionService), execute);
  const bodyLogGroupService = withBodyLogExecution(new BodyLogGroupService(stores.group, database, notificationService, subscriptionService), execute);
  const bodyLogWorkerService = new BodyLogWorkerService(stores.jobs, bodyLogBuddyService, bodyLogGroupService, logger);
  return {
    bodyLogProfileService,
    bodyLogSocialService,
    bodyLogLeaderboardService,
    bodyLogInvitationService,
    bodyLogChallengeService,
    bodyLogBuddyService,
    bodyLogGroupService,
    bodyLogWorkerService,
    bodyLogGrowthService,
    bodyLogNotificationService,
    bodyLogFeatureFlagService,
  };
}
