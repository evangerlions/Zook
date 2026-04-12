import { badRequest } from "../../shared/errors.ts";
import type { AnalyticsEventInput, MetricsOverviewItem, PageMetricItem, Platform } from "../../shared/types.ts";
import { enumerateDateKeys, toDateKey, randomId } from "../../shared/utils.ts";
import { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import { AppRegistryService } from "../app-registry/app-registry.service.ts";

const SUPPORTED_EVENTS = new Set(["page_view", "page_leave", "page_heartbeat"]);
const MAX_BATCH_SIZE = 200;
const DEFAULT_TIMEZONE_OFFSET = "+08:00";

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

    if (command.events.length > MAX_BATCH_SIZE) {
      badRequest("ANALYTICS_BATCH_TOO_LARGE", `Analytics batch size exceeds ${MAX_BATCH_SIZE}.`);
    }

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

  async getOverview(appId: string, dateFrom: string, dateTo: string): Promise<{ timezone: string; items: MetricsOverviewItem[] }> {
    this.assertDateRange(dateFrom, dateTo);
    await this.appRegistryService.getAppOrThrow(appId);
    const range = this.buildDateRange(dateFrom, dateTo);
    const analyticsEvents = await this.database.listAnalyticsEvents(appId, range);
    const appUsers = await this.database.listAppUsers(appId);

    const items = enumerateDateKeys(dateFrom, dateTo).map((dateKey) => {
      const dailyEvents = analyticsEvents.filter(
        (item) => toDateKey(item.occurredAt) === dateKey,
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
    const range = this.buildDateRange(dateFrom, dateTo);
    const analyticsEvents = await this.database.listAnalyticsEvents(appId, {
      ...range,
      platform,
    });

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
      .filter((item) => dateKeys.has(toDateKey(item.occurredAt)))
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

  private buildDateRange(dateFrom: string, dateTo: string): { occurredFrom: string; occurredTo: string } {
    const start = new Date(`${dateFrom}T00:00:00${DEFAULT_TIMEZONE_OFFSET}`);
    const end = new Date(`${dateTo}T00:00:00${DEFAULT_TIMEZONE_OFFSET}`);
    end.setDate(end.getDate() + 1);
    return {
      occurredFrom: start.toISOString(),
      occurredTo: end.toISOString(),
    };
  }
}
