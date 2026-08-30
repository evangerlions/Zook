import { badRequest } from "../../shared/errors.ts";
import type { AnalyticsEventInput, EventName, MetricsOverviewItem, PageMetricItem, Platform } from "../../shared/types.ts";
import { enumerateDateKeys, toDateKey, randomId, sha256 } from "../../shared/utils.ts";
import { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import { AppRegistryService } from "../app-registry/app-registry.service.ts";

const SUPPORTED_EVENTS = new Set([
  "page_view",
  "page_leave",
  "page_heartbeat",
  // FrogSleep server-initiated analytics events
  "frogsleep_sleep_invite_created",
  "frogsleep_sleep_invite_accepted",
  "frogsleep_sleep_invite_declined",
  "frogsleep_session_started",
  "frogsleep_session_interrupted",
  "frogsleep_session_returned",
  "frogsleep_morning_completed",
  "frogsleep_focus_session_reported",
  "frogsleep_focus_relationship_created",
  "frogsleep_focus_achievement_unlocked",
  "lighttick_guest_created", "lighttick_account_upgraded", "lighttick_session_recovered",
  "lighttick_wish_submitted", "lighttick_starter_shown", "lighttick_starter_started", "lighttick_starter_completed",
  "lighttick_preview_viewed", "lighttick_weekly_commitment", "lighttick_plan_confirmed",
  "lighttick_task_started", "lighttick_task_completed", "lighttick_task_skipped", "lighttick_task_deferred",
  "lighttick_goal_paused", "lighttick_goal_resumed", "lighttick_recovery_started", "lighttick_return_observed",
  "lighttick_review_viewed", "lighttick_proposal_accepted", "lighttick_proposal_rejected", "lighttick_sync_conflict",
  "lighttick_notification_queued", "lighttick_notification_delivered", "lighttick_notification_suppressed", "lighttick_notification_failed",
]);

/**
 * AnalyticsService owns event ingestion and the app-scoped metric definitions from the document.
 */
export class AnalyticsService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly appRegistryService: AppRegistryService,
  ) {}

  async recordBatch(
    command: { appId: string; userId: string; events: AnalyticsEventInput[] },
    now = new Date(),
  ): Promise<{ accepted: number }> {
    await this.appRegistryService.getAppOrThrow(command.appId);

    command.events.forEach((event) => this.validateEvent(event));

    await this.database.insertAnalyticsEvents(command.events.map((event) => ({
        id: randomId("analytics"),
        appId: command.appId,
        userId: command.userId,
        platform: event.platform,
        sessionId: event.sessionId,
        pageKey: event.pageKey,
        eventName: event.eventName,
        durationMs: event.durationMs,
        occurredAt: event.occurredAt,
        receivedAt: now.toISOString(),
        metadata: event.metadata ?? {},
      })));

    return {
      accepted: command.events.length,
    };
  }

  async recordServerEvent(event: { appId: string; userId: string; eventName: EventName; dedupeKey: string;
    pageKey: string; platform: Platform; occurredAt: string; metadata?: Record<string, unknown> }): Promise<void> {
    await this.appRegistryService.getAppOrThrow(event.appId);
    if (!SUPPORTED_EVENTS.has(event.eventName)) badRequest("REQ_INVALID_EVENT", `Unsupported event name: ${event.eventName}.`);
    const id = `analytics_${sha256(`${event.appId}:${event.userId}:${event.dedupeKey}`).slice(0, 40)}`;
    await this.database.insertAnalyticsEvents([{ id, appId: event.appId, userId: event.userId, platform: event.platform,
      sessionId: `server:${event.userId}`, pageKey: event.pageKey, eventName: event.eventName,
      occurredAt: event.occurredAt, receivedAt: new Date().toISOString(), metadata: event.metadata ?? {} }]);
  }

  async getOverview(appId: string, dateFrom: string, dateTo: string): Promise<{ timezone: string; items: MetricsOverviewItem[] }> {
    this.assertDateRange(dateFrom, dateTo);
    await this.appRegistryService.getAppOrThrow(appId);
    const analyticsEvents = await this.database.listAnalyticsEvents(appId);
    const appUsers = await this.database.listAppUsers(appId);

    const items = enumerateDateKeys(dateFrom, dateTo).map((dateKey) => {
      const dailyEvents = analyticsEvents.filter(
        (item) => item.appId === appId && toDateKey(item.occurredAt) === dateKey,
      );
      const dau = new Set(dailyEvents.map((item) => item.userId)).size;
      const newUsers = appUsers.filter(
        (item) => item.appId === appId && toDateKey(item.joinedAt) === dateKey,
      ).length;

      return {
        date: dateKey,
        dau,
        newUsers,
      };
    });

    return {
      timezone: "Asia/Shanghai",
      items,
    };
  }

  async getPageMetrics(
    appId: string,
    dateFrom: string,
    dateTo: string,
    platform?: Platform,
  ): Promise<{ timezone: string; items: PageMetricItem[] }> {
    this.assertDateRange(dateFrom, dateTo);
    await this.appRegistryService.getAppOrThrow(appId);
    const analyticsEvents = await this.database.listAnalyticsEvents(appId);

    const dateKeys = new Set(enumerateDateKeys(dateFrom, dateTo));
    const groups = new Map<
      string,
      {
        pageKey: string;
        platform: Platform;
        users: Set<string>;
        sessions: Set<string>;
        totalDurationMs: number;
      }
    >();

    analyticsEvents
      .filter((item) => item.appId === appId)
      .filter((item) => dateKeys.has(toDateKey(item.occurredAt)))
      .filter((item) => (platform ? item.platform === platform : true))
      .forEach((item) => {
        const groupKey = `${item.platform}:${item.pageKey}`;
        const existing =
          groups.get(groupKey) ??
          {
            pageKey: item.pageKey,
            platform: item.platform,
            users: new Set<string>(),
            sessions: new Set<string>(),
            totalDurationMs: 0,
          };

        existing.users.add(item.userId);
        existing.sessions.add(item.sessionId);
        existing.totalDurationMs += item.durationMs ?? 0;
        groups.set(groupKey, existing);
      });

    const items = [...groups.values()]
      .map<PageMetricItem>((item) => ({
        pageKey: item.pageKey,
        platform: item.platform,
        uv: item.users.size,
        sessionCount: item.sessions.size,
        totalDurationMs: item.totalDurationMs,
        avgDurationMs: item.sessions.size
          ? Math.round(item.totalDurationMs / item.sessions.size)
          : 0,
      }))
      .sort((left, right) => right.totalDurationMs - left.totalDurationMs);

    return {
      timezone: "Asia/Shanghai",
      items,
    };
  }

  private validateEvent(event: AnalyticsEventInput): void {
    if (!SUPPORTED_EVENTS.has(event.eventName)) {
      badRequest("REQ_INVALID_EVENT", `Unsupported event name: ${event.eventName}.`);
    }

    if (!event.sessionId || !event.pageKey || !event.occurredAt) {
      badRequest("REQ_INVALID_EVENT", "Analytics events require sessionId, pageKey and occurredAt.");
    }

    if (event.durationMs !== undefined && event.durationMs < 0) {
      badRequest("REQ_INVALID_EVENT", "Analytics duration must be zero or positive.");
    }
  }

  private assertDateRange(dateFrom: string, dateTo: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      badRequest("REQ_DATE_RANGE_INVALID", "Dates must use YYYY-MM-DD format.");
    }

    if (dateFrom > dateTo) {
      badRequest("REQ_DATE_RANGE_INVALID", "dateFrom must be earlier than or equal to dateTo.");
    }
  }
}
