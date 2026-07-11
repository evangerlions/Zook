import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { badRequest } from "../shared/errors.ts";
import type {
  AiNovelDailyStatisticsRecord,
  AiNovelStatisticsDailyItem,
  AiNovelStatisticsDocument,
  AiNovelStatisticsSnapshotRequest,
  AiNovelStatisticsSnapshotResponse,
  AuthContext,
} from "../shared/types.ts";
import { enumerateDateKeys, toDateKey } from "../shared/utils.ts";

const AI_NOVEL_APP_ID = "ai_novel";
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const MAX_DAILY_SNAPSHOT_ITEMS = 400;
const ALL_TIME_DATE_FROM = "1970-01-01";

interface TokenUsageCommand {
  appId: string;
  userId: string;
  totalTokens: number;
  occurredAt?: Date;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    badRequest("REQ_INVALID_BODY", `${field} must be a non-negative integer.`);
  }
  return value;
}

function assertDateKey(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    badRequest("REQ_INVALID_BODY", `${field} must use YYYY-MM-DD.`);
  }
  return value;
}

function dateKeyDaysAgo(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() - days);
  return toDateKey(date);
}

function monthStart(dateKey: string): string {
  return `${dateKey.slice(0, 8)}01`;
}

function maxDateKey(left: string, right: string): string {
  return left > right ? left : right;
}

function toDailyMap(records: AiNovelDailyStatisticsRecord[]): Map<string, AiNovelDailyStatisticsRecord> {
  return new Map(records.map((record) => [record.date, record]));
}

export class AiNovelStatisticsService {
  constructor(private readonly database: ApplicationDatabase) {}

  async recordSnapshot(
    auth: AuthContext,
    body: Record<string, unknown>,
    now = new Date(),
  ): Promise<AiNovelStatisticsSnapshotResponse> {
    if (auth.appId !== AI_NOVEL_APP_ID) {
      badRequest("AUTH_APP_SCOPE_MISMATCH", "Statistics can only be submitted from ai_novel.");
    }

    const parsed = this.parseSnapshotRequest(body);
    const updatedAt = now.toISOString();
    await this.database.upsertAiNovelStatisticsSnapshot({
      appId: auth.appId,
      userId: auth.userId,
      totalWorks: parsed.totalWorks,
      totalWords: parsed.totalWords,
      totalChapters: parsed.totalChapters,
      activeWritingDays: parsed.activeWritingDays,
      updatedAt,
    });
    await this.database.upsertAiNovelDailyWritingStats(
      (parsed.daily ?? []).map((item) => ({
        appId: auth.appId,
        userId: auth.userId,
        date: item.date,
        words: item.words,
        tokens: 0,
        active: item.active ?? item.words > 0,
        updatedAt,
      })),
    );

    return { accepted: true, updatedAt };
  }

  async recordTokenUsage(command: TokenUsageCommand): Promise<void> {
    if (command.appId !== AI_NOVEL_APP_ID) {
      return;
    }
    const totalTokens = Math.max(0, Math.floor(command.totalTokens));
    if (totalTokens <= 0) {
      return;
    }
    const occurredAt = command.occurredAt ?? new Date();
    await this.database.incrementAiNovelDailyTokenUsage(
      command.appId,
      command.userId,
      toDateKey(occurredAt, DEFAULT_TIMEZONE),
      totalTokens,
      occurredAt.toISOString(),
    );
  }

  async getStatistics(
    auth: AuthContext,
    now = new Date(),
  ): Promise<AiNovelStatisticsDocument> {
    if (auth.appId !== AI_NOVEL_APP_ID) {
      badRequest("AUTH_APP_SCOPE_MISMATCH", "Statistics can only be read from ai_novel.");
    }

    const today = toDateKey(now, DEFAULT_TIMEZONE);
    const last30Start = dateKeyDaysAgo(today, 29);
    const currentMonthStart = monthStart(today);
    const rangeStart = maxDateKey(
      ALL_TIME_DATE_FROM,
      currentMonthStart < last30Start ? currentMonthStart : last30Start,
    );
    const [snapshot, allDaily, recentDaily] = await Promise.all([
      this.database.findAiNovelStatisticsSnapshot(auth.appId, auth.userId),
      this.database.listAiNovelDailyStatistics({
        appId: auth.appId,
        userId: auth.userId,
        dateFrom: ALL_TIME_DATE_FROM,
        dateTo: today,
      }),
      this.database.listAiNovelDailyStatistics({
        appId: auth.appId,
        userId: auth.userId,
        dateFrom: rangeStart,
        dateTo: today,
      }),
    ]);

    const recentMap = toDailyMap(recentDaily);
    const trendDays = enumerateDateKeys(last30Start, today).map<AiNovelStatisticsDailyItem>((date) => {
      const record = recentMap.get(date);
      return {
        date,
        words: record?.words ?? 0,
        tokens: record?.tokens ?? 0,
        active: record?.active ?? false,
      };
    });
    const todayRecord = recentMap.get(today);
    const monthRecords = recentDaily.filter((item) => item.date >= currentMonthStart);
    const totalTokens = allDaily.reduce((sum, item) => sum + item.tokens, 0);
    const activeWritingDaysFromDaily = allDaily.filter((item) => item.active || item.words > 0).length;

    return {
      timezone: DEFAULT_TIMEZONE,
      generatedAt: now.toISOString(),
      overview: {
        totalWorks: snapshot?.totalWorks ?? 0,
        totalWords: snapshot?.totalWords ?? 0,
        totalChapters: snapshot?.totalChapters ?? 0,
        activeWritingDays: Math.max(snapshot?.activeWritingDays ?? 0, activeWritingDaysFromDaily),
      },
      recentActivity: {
        wordsToday: todayRecord?.words ?? 0,
        wordsThisMonth: monthRecords.reduce((sum, item) => sum + item.words, 0),
        tokensToday: todayRecord?.tokens ?? 0,
        tokensThisMonth: monthRecords.reduce((sum, item) => sum + item.tokens, 0),
        activeWritingDaysLast30Days: trendDays.filter((item) => item.active || item.words > 0).length,
      },
      writingTrend: {
        days: trendDays,
      },
      summaryCard: {
        totalWords: snapshot?.totalWords ?? 0,
        totalTokens,
      },
    };
  }

  private parseSnapshotRequest(body: Record<string, unknown>): AiNovelStatisticsSnapshotRequest {
    const totalWorks = requireNonNegativeInteger(body.totalWorks, "totalWorks");
    const totalWords = requireNonNegativeInteger(body.totalWords, "totalWords");
    const totalChapters = requireNonNegativeInteger(body.totalChapters, "totalChapters");
    const activeWritingDays = requireNonNegativeInteger(body.activeWritingDays, "activeWritingDays");
    const daily = body.daily === undefined ? [] : body.daily;
    if (!Array.isArray(daily)) {
      badRequest("REQ_INVALID_BODY", "daily must be an array.");
    }
    if (daily.length > MAX_DAILY_SNAPSHOT_ITEMS) {
      badRequest("REQ_INVALID_BODY", "daily supports at most 400 items.");
    }
    return {
      totalWorks,
      totalWords,
      totalChapters,
      activeWritingDays,
      daily: daily.map((raw, index) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          badRequest("REQ_INVALID_BODY", `daily[${index}] must be an object.`);
        }
        const item = raw as Record<string, unknown>;
        return {
          date: assertDateKey(item.date, `daily[${index}].date`),
          words: requireNonNegativeInteger(item.words, `daily[${index}].words`),
          active: typeof item.active === "boolean" ? item.active : undefined,
        };
      }),
    };
  }
}
