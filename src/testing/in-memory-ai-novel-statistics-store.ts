import type {
  AiNovelDailyStatisticsRecord,
  AiNovelStatisticsSnapshotRecord,
} from "../shared/types.ts";

export class InMemoryAiNovelStatisticsStore {
  readonly snapshots: AiNovelStatisticsSnapshotRecord[];
  readonly dailyStatistics: AiNovelDailyStatisticsRecord[];

  constructor(seed: {
    snapshots?: AiNovelStatisticsSnapshotRecord[];
    dailyStatistics?: AiNovelDailyStatisticsRecord[];
  } = {}) {
    this.snapshots = structuredClone(seed.snapshots ?? []);
    this.dailyStatistics = structuredClone(seed.dailyStatistics ?? []);
  }

  deleteApp(appId: string): void {
    this.removeWhere((item) => item.appId === appId);
  }

  deleteUser(appId: string, userId: string): void {
    this.removeWhere((item) => item.appId === appId && item.userId === userId);
  }

  upsertSnapshot(record: AiNovelStatisticsSnapshotRecord): void {
    const index = this.snapshots.findIndex(
      (item) => item.appId === record.appId && item.userId === record.userId,
    );
    if (index >= 0) {
      this.snapshots[index] = structuredClone(record);
      return;
    }
    this.snapshots.push(structuredClone(record));
  }

  findSnapshot(
    appId: string,
    userId: string,
  ): AiNovelStatisticsSnapshotRecord | undefined {
    return structuredClone(
      this.snapshots.find(
        (item) => item.appId === appId && item.userId === userId,
      ),
    );
  }

  replaceDailyWritingStats(
    appId: string,
    userId: string,
    records: AiNovelDailyStatisticsRecord[],
    updatedAt: string,
  ): void {
    for (const existing of this.dailyStatistics) {
      if (existing.appId === appId && existing.userId === userId) {
        existing.words = 0;
        existing.active = false;
        existing.updatedAt = updatedAt;
      }
    }
    for (const record of records) {
      const existing = this.dailyStatistics.find(
        (item) =>
          item.appId === record.appId &&
          item.userId === record.userId &&
          item.date === record.date,
      );
      if (existing) {
        existing.words = record.words;
        existing.active = record.active;
        existing.updatedAt = record.updatedAt;
      } else {
        this.dailyStatistics.push(structuredClone(record));
      }
    }
  }

  incrementTokenUsage(
    appId: string,
    userId: string,
    date: string,
    tokens: number,
    updatedAt: string,
  ): void {
    const normalizedTokens = Math.max(0, Math.floor(tokens));
    const existing = this.dailyStatistics.find(
      (item) => item.appId === appId && item.userId === userId && item.date === date,
    );
    if (existing) {
      existing.tokens += normalizedTokens;
      existing.updatedAt = updatedAt;
      return;
    }
    this.dailyStatistics.push({
      appId,
      userId,
      date,
      words: 0,
      tokens: normalizedTokens,
      active: false,
      updatedAt,
    });
  }

  listDailyStatistics(filter: {
    appId: string;
    userId: string;
    dateFrom?: string;
    dateTo?: string;
  }): AiNovelDailyStatisticsRecord[] {
    return structuredClone(this.dailyStatistics)
      .filter((item) => item.appId === filter.appId && item.userId === filter.userId)
      .filter((item) => filter.dateFrom ? item.date >= filter.dateFrom : true)
      .filter((item) => filter.dateTo ? item.date <= filter.dateTo : true)
      .sort((left, right) => left.date.localeCompare(right.date));
  }

  private removeWhere(
    predicate: (record: AiNovelStatisticsSnapshotRecord | AiNovelDailyStatisticsRecord) => boolean,
  ): void {
    this.removeMatching(this.snapshots, predicate);
    this.removeMatching(this.dailyStatistics, predicate);
  }

  private removeMatching<T>(items: T[], predicate: (record: T) => boolean): void {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (predicate(items[index] as T)) {
        items.splice(index, 1);
      }
    }
  }
}
