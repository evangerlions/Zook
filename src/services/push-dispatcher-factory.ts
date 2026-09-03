import { readFileSync } from "node:fs";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import { ApnsPushDispatcher } from "./apns-push-dispatcher.ts";
import { CompositePushDispatcher } from "./composite-push-dispatcher.ts";
import { FcmPushDispatcher } from "./fcm-push-dispatcher.ts";
import type { PushDispatcher, PushDispatchRequest } from "./notification.service.ts";

export function createPushDispatcher(options: {
  database: ApplicationDatabase;
  logger: StructuredLogger;
}): PushDispatcher {
  const { database, logger } = options;
  const dispatchers: Record<string, PushDispatcher | undefined> = {};

  const apnsKeyId = process.env.APNS_KEY_ID?.trim();
  const apnsTeamId = process.env.APNS_TEAM_ID?.trim();
  const apnsBundleId = process.env.APNS_BUNDLE_ID?.trim() ?? process.env.APNS_TOPIC?.trim();
  const apnsKeyPath = process.env.APNS_PRIVATE_KEY_PATH?.trim();
  const lightTickApnsBundleId = process.env.LIGHTTICK_APNS_BUNDLE_ID?.trim();
  const apnsSandbox = process.env.APNS_SANDBOX?.trim().toLowerCase() === "true";

  if (apnsKeyId && apnsTeamId && apnsBundleId && apnsKeyPath) {
    try {
      const privateKeyPem = readFileSync(apnsKeyPath, "utf8");
      dispatchers.ios = new ApnsPushDispatcher(
        {
          teamId: apnsTeamId,
          keyId: apnsKeyId,
          bundleId: apnsBundleId,
          bundleIds: lightTickApnsBundleId ? { lighttick: lightTickApnsBundleId } : undefined,
          privateKeyPem,
          production: !apnsSandbox,
        },
        { logger, database },
      );
      logger.info("APNs push dispatcher configured", {
        teamId: apnsTeamId,
        bundleId: apnsBundleId,
        production: !apnsSandbox,
      });
    } catch (error) {
      logger.error("failed to configure APNs push dispatcher", {
        error: error instanceof Error ? error.message : "unknown",
        keyPath: apnsKeyPath,
      });
    }
  }

  const fcmProjectId = process.env.FCM_PROJECT_ID?.trim();
  const fcmServiceAccountPath = process.env.FCM_SERVICE_ACCOUNT_PATH?.trim();

  if (fcmProjectId && fcmServiceAccountPath) {
    try {
      const serviceAccount = JSON.parse(readFileSync(fcmServiceAccountPath, "utf8")) as {
        client_email: string;
        private_key: string;
      };
      dispatchers.android = new FcmPushDispatcher(
        {
          projectId: fcmProjectId,
          clientEmail: serviceAccount.client_email,
          privateKeyPem: serviceAccount.private_key,
        },
        { logger, database },
      );
      logger.info("FCM push dispatcher configured", { projectId: fcmProjectId });
    } catch (error) {
      logger.error("failed to configure FCM push dispatcher", {
        error: error instanceof Error ? error.message : "unknown",
        serviceAccountPath: fcmServiceAccountPath,
      });
    }
  }

  const lightTickFcmProjectId = process.env.LIGHTTICK_FCM_PROJECT_ID?.trim();
  const lightTickFcmServiceAccountPath = process.env.LIGHTTICK_FCM_SERVICE_ACCOUNT_PATH?.trim();
  if (lightTickFcmProjectId && lightTickFcmServiceAccountPath) {
    try {
      const serviceAccount = JSON.parse(readFileSync(lightTickFcmServiceAccountPath, "utf8")) as {
        client_email: string;
        private_key: string;
      };
      dispatchers["lighttick:android"] = new FcmPushDispatcher({ projectId: lightTickFcmProjectId,
        clientEmail: serviceAccount.client_email, privateKeyPem: serviceAccount.private_key }, { logger, database });
      logger.info("LightTick FCM push dispatcher configured", { projectId: lightTickFcmProjectId });
    } catch (error) {
      logger.error("failed to configure LightTick FCM push dispatcher", {
        error: error instanceof Error ? error.message : "unknown", serviceAccountPath: lightTickFcmServiceAccountPath,
      });
    }
  }

  if (Object.keys(dispatchers).length === 0) {
    logger.info("no push dispatchers configured, using logging fallback");
    return {
      async dispatch(req: PushDispatchRequest): Promise<void> {
        logger.info("push notification dispatched (logging fallback)", {
          appId: req.appId,
          userId: req.userId,
          platform: req.platform,
          notificationType: req.payload.type,
        });
      },
    } satisfies PushDispatcher;
  }

  return new CompositePushDispatcher(dispatchers, { logger });
}
