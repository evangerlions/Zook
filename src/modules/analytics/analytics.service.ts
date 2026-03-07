import { badRequest } from "../../shared/errors.ts";
import type { AnalyticsEventInput, MetricsOverviewItem, PageMetricItem, Platform } from "../../shared/types.ts";
import { enumerateDateKeys, toDateKey, randomId } from "../../shared/utils.ts";
import { InMemoryDatabase } from "../../infrastructure/database/prisma/in-memory-database.ts";
import { AppRegistryService } from "../app-registry/app-registry.service.ts";

const SUPPORTED_EVENTS = new Set(["page_view", "page_leave", "page_heartbeat"]);

/**
 * AnalyticsService owns event ingestion and the app-scoped metric definitions from the document.
 */
export class AnalyticsService {
  constructor(
    private readonly database: InMemoryDatabase,
    private readonly appRegistryService: AppRegistryService,
  ) {}

  recordBatch(
    command: { appId: string; userId: string; events: AnalyticsEventInput[] },
    now = new Date(),
  ): { accepted: number } {
    this.appRegistryService.getAppOrThrow(command.appId);

    command.events.forEach((event) => this.validateEvent(event));

    command.events.forEach((event) => {
      this.database.analyticsEvents.push({
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
      });
    });

    return {
      accepted: command.events.length,
    };
  }

  getOverview(appId: string, dateFrom: string, dateTo: string): { timezone: string; items: MetricsOverviewItem[] } {
    this.assertDateRange(dateFrom, dateTo);
    this.appRegistryService.getAppOrThrow(appId);

    const items = enumerateDateKeys(dateFrom, dateTo).map((dateKey) => {
      const dailyEvents = this.database.analyticsEvents.filter(
        (item) => item.appId === appId && toDateKey(item.occurredAt) === dateKey,
      );
      const dau = new Set(dailyEvents.map((item) => item.userId)).size;
      const newUsers = this.database.appUsers.filter(
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

  getPageMetrics(
    appId: string,
    dateFrom: string,
    dateTo: string,
    platform?: Platform,
  ): { timezone: string; items: PageMetricItem[] } {
    this.assertDateRange(dateFrom, dateTo);
    this.appRegistryService.getAppOrThrow(appId);

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

    this.database.analyticsEvents
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
