export interface AiNovelStatisticsDailyItem {
  date: string;
  words: number;
  tokens: number;
  active: boolean;
}

export interface AiNovelStatisticsOverview {
  totalWorks: number;
  totalWords: number;
  totalChapters: number;
  activeWritingDays: number;
}

export interface AiNovelStatisticsRecentActivity {
  wordsToday: number;
  wordsThisMonth: number;
  tokensToday: number;
  tokensThisMonth: number;
  activeWritingDaysLast30Days: number;
}

export interface AiNovelStatisticsSummaryCard {
  totalWords: number;
  totalTokens: number;
}

export interface AiNovelStatisticsDocument {
  timezone: string;
  generatedAt: string;
  overview: AiNovelStatisticsOverview;
  recentActivity: AiNovelStatisticsRecentActivity;
  writingTrend: {
    days: AiNovelStatisticsDailyItem[];
  };
  summaryCard: AiNovelStatisticsSummaryCard;
}

export interface AiNovelStatisticsSnapshotDailyInput {
  date: string;
  words: number;
  active?: boolean;
}

export interface AiNovelStatisticsSnapshotRequest {
  accountId: string;
  totalWorks: number;
  totalWords: number;
  totalChapters: number;
  activeWritingDays: number;
  daily?: AiNovelStatisticsSnapshotDailyInput[];
}

export interface AiNovelStatisticsSnapshotResponse {
  accepted: true;
  updatedAt: string;
}
