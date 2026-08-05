import { randomId } from "../../shared/utils.ts";
import type { EventName } from "../../shared/types.ts";
import type { StructuredLogger } from "../../infrastructure/logging/pino-logger.module.ts";
import type { AnalyticsService } from "../analytics/analytics.service.ts";

export type FrogSleepAnalyticsEvent = Extract<EventName, `frogsleep_${string}`>;

interface EmitOptions {
  analyticsService?: AnalyticsService;
  logger?: StructuredLogger;
}

/**
 * Emit a FrogSleep analytics event asynchronously.
 *
 * Failures are caught and logged — analytics never blocks or fails business logic.
 * The event is inserted directly into the analytics_events table using the
 * analytics service's recordBatch method.
 */
export async function emitFrogSleepAnalyticsEvent(
  options: EmitOptions,
  event: {
    name: FrogSleepAnalyticsEvent;
    appId: string;
    userId: string;
    platform?: "ios" | "android" | "web";
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { analyticsService, logger } = options;
  if (!analyticsService) return;

  try {
    await analyticsService.recordBatch({
      appId: event.appId,
      userId: event.userId,
      events: [
        {
          platform: event.platform ?? "ios",
          sessionId: randomId("session"),
          pageKey: "frogsleep",
          eventName: event.name,
          occurredAt: new Date().toISOString(),
          metadata: event.metadata ?? {},
        },
      ],
    });
  } catch (error) {
    logger?.warn("frogsleep analytics event failed (non-blocking)", {
      event: event.name,
      appId: event.appId,
      userId: event.userId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
