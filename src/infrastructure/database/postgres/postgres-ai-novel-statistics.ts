import type {
  AiNovelDailyStatisticsRecord,
  AiNovelStatisticsSnapshotRecord,
} from "../../../shared/types.ts";
import { toIsoString } from "./postgres-row-utils.ts";

type PostgresQuery = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

function parseSnapshot(row: Record<string, unknown>): AiNovelStatisticsSnapshotRecord {
  return {
    appId: String(row.app_id),
    userId: String(row.user_id),
    totalWorks: Number(row.total_works ?? 0),
    totalWords: Number(row.total_words ?? 0),
    totalChapters: Number(row.total_chapters ?? 0),
    activeWritingDays: Number(row.active_writing_days ?? 0),
    updatedAt: toIsoString(row.updated_at),
  };
}

function parseDaily(row: Record<string, unknown>): AiNovelDailyStatisticsRecord {
  return {
    appId: String(row.app_id),
    userId: String(row.user_id),
    date: String(row.date_key),
    words: Number(row.words ?? 0),
    tokens: Number(row.tokens ?? 0),
    active: Boolean(row.active),
    updatedAt: toIsoString(row.updated_at),
  };
}

export class PostgresAiNovelStatisticsStore {
  constructor(private readonly query: PostgresQuery) {}

  async upsertSnapshot(record: AiNovelStatisticsSnapshotRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_ai_novel_statistics_snapshots (
         app_id, user_id, total_works, total_words, total_chapters,
         active_writing_days, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
       ON CONFLICT (app_id, user_id) DO UPDATE SET
         total_works = EXCLUDED.total_works,
         total_words = EXCLUDED.total_words,
         total_chapters = EXCLUDED.total_chapters,
         active_writing_days = EXCLUDED.active_writing_days,
         updated_at = EXCLUDED.updated_at`,
      [
        record.appId,
        record.userId,
        record.totalWorks,
        record.totalWords,
        record.totalChapters,
        record.activeWritingDays,
        record.updatedAt,
      ],
    );
  }

  async findSnapshot(
    appId: string,
    userId: string,
  ): Promise<AiNovelStatisticsSnapshotRecord | undefined> {
    const result = await this.query(
      `SELECT app_id, user_id, total_works, total_words, total_chapters,
              active_writing_days, updated_at
       FROM zook_ai_novel_statistics_snapshots
       WHERE app_id = $1 AND user_id = $2
       LIMIT 1`,
      [appId, userId],
    );
    return result.rows[0] ? parseSnapshot(result.rows[0]) : undefined;
  }

  async replaceDailyWritingStats(
    appId: string,
    userId: string,
    records: AiNovelDailyStatisticsRecord[],
    updatedAt: string,
  ): Promise<void> {
    await this.query(
      `UPDATE zook_ai_novel_daily_statistics
       SET words = 0, active = FALSE, updated_at = $3::timestamptz
       WHERE app_id = $1 AND user_id = $2`,
      [appId, userId, updatedAt],
    );
    for (const record of records) {
      await this.query(
        `INSERT INTO zook_ai_novel_daily_statistics (
           app_id, user_id, date_key, words, tokens, active, updated_at
         )
         VALUES ($1, $2, $3, $4, 0, $5, $6::timestamptz)
         ON CONFLICT (app_id, user_id, date_key) DO UPDATE SET
           words = EXCLUDED.words,
           active = EXCLUDED.active,
           updated_at = EXCLUDED.updated_at`,
        [
          record.appId,
          record.userId,
          record.date,
          record.words,
          record.active,
          record.updatedAt,
        ],
      );
    }
  }

  async incrementDailyTokenUsage(
    appId: string,
    userId: string,
    date: string,
    tokens: number,
    updatedAt: string,
  ): Promise<void> {
    await this.query(
      `INSERT INTO zook_ai_novel_daily_statistics (
         app_id, user_id, date_key, words, tokens, active, updated_at
       )
       VALUES ($1, $2, $3, 0, $4, FALSE, $5::timestamptz)
       ON CONFLICT (app_id, user_id, date_key) DO UPDATE SET
         tokens = zook_ai_novel_daily_statistics.tokens + EXCLUDED.tokens,
         updated_at = EXCLUDED.updated_at`,
      [appId, userId, date, Math.max(0, Math.floor(tokens)), updatedAt],
    );
  }

  async listDailyStatistics(filter: {
    appId: string;
    userId: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<AiNovelDailyStatisticsRecord[]> {
    const clauses = ["app_id = $1", "user_id = $2"];
    const values: unknown[] = [filter.appId, filter.userId];
    if (filter.dateFrom) {
      values.push(filter.dateFrom);
      clauses.push(`date_key >= $${values.length}`);
    }
    if (filter.dateTo) {
      values.push(filter.dateTo);
      clauses.push(`date_key <= $${values.length}`);
    }
    const result = await this.query(
      `SELECT app_id, user_id, date_key, words, tokens, active, updated_at
       FROM zook_ai_novel_daily_statistics
       WHERE ${clauses.join(" AND ")}
       ORDER BY date_key ASC`,
      values,
    );
    return result.rows.map(parseDaily);
  }
}
