import type { LightTickOwner } from "../lighttick.types.ts";

/**
 * 阅读域持久化类型。
 *
 * 口径（与 `reading-domain-design.md` 一致，且必须与 SQL 约束一致）：
 * - 判重键是 `urlHash`，不是原始 `url`；
 * - `bodyKind` 显式区分「有全文 / 只有节选 / 只有链接」，导读依据不允许靠猜；
 * - 位置与读完在 `states`，私人反馈在 `feedback`，两套独立 CAS；
 * - 读完只看 `completedAt`，不从 `positionRatio` 推断；
 * - 评分允许 null：「没判断」不等于「3 分」。
 */

export type ReadingBodyKind = "full" | "excerpt" | "none";
export type ReadingLanguage = "zh" | "en";
export type ReadingGuideBasis = "full_text" | "summary";

export interface LightTickReadingArticleRow {
  appId: string;
  userId: string;
  id: string;
  url: string;
  urlHash: string;
  title: string;
  source: string;
  language: ReadingLanguage;
  topic: string;
  summary: string;
  body: string;
  bodyKind: ReadingBodyKind;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface LightTickReadingGuideRow {
  appId: string;
  userId: string;
  articleId: string;
  basis: ReadingGuideBasis;
  corePoints: string[];
  evidenceLimits: string[];
  languageNotes: string[];
  applicationQuestions: string[];
  model: string;
  revision: number;
  generatedAt: string;
  updatedAt: string;
}

export interface LightTickReadingStateRow {
  appId: string;
  userId: string;
  articleId: string;
  positionRatio: number;
  positionAnchor: string;
  completedAt: string | null;
  revision: number;
  updatedAt: string;
}

export interface LightTickReadingFeedbackRow {
  appId: string;
  userId: string;
  articleId: string;
  valueRating: number | null;
  difficulty: number | null;
  takeaway: string;
  question: string;
  application: string;
  tags: string[];
  revision: number;
  updatedAt: string;
}

export interface LightTickReadingDailyRow {
  appId: string;
  userId: string;
  businessDate: string;
  ordinal: number;
  articleId: string;
  reason: string;
  createdAt: string;
}

export interface ReadingRepository {
  listReadingArticles(owner: LightTickOwner): Promise<LightTickReadingArticleRow[]>;
  getReadingArticle(owner: LightTickOwner, id: string): Promise<LightTickReadingArticleRow | undefined>;
  findReadingArticleByUrlHash(owner: LightTickOwner, urlHash: string): Promise<LightTickReadingArticleRow | undefined>;
  saveReadingArticle(row: LightTickReadingArticleRow, expectedRevision?: number): Promise<LightTickReadingArticleRow>;
  deleteReadingArticle(owner: LightTickOwner, id: string): Promise<void>;
  getReadingGuide(owner: LightTickOwner, articleId: string): Promise<LightTickReadingGuideRow | undefined>;
  saveReadingGuide(row: LightTickReadingGuideRow, expectedRevision?: number): Promise<LightTickReadingGuideRow>;
  getReadingState(owner: LightTickOwner, articleId: string): Promise<LightTickReadingStateRow | undefined>;
  saveReadingState(row: LightTickReadingStateRow, expectedRevision?: number): Promise<LightTickReadingStateRow>;
  getReadingFeedback(owner: LightTickOwner, articleId: string): Promise<LightTickReadingFeedbackRow | undefined>;
  saveReadingFeedback(row: LightTickReadingFeedbackRow, expectedRevision?: number): Promise<LightTickReadingFeedbackRow>;
  listReadingDaily(owner: LightTickOwner, businessDate: string): Promise<LightTickReadingDailyRow[]>;
  listReadingDailySince(owner: LightTickOwner, sinceDate: string): Promise<LightTickReadingDailyRow[]>;
  listReadingStates(owner: LightTickOwner): Promise<LightTickReadingStateRow[]>;
  listReadingFeedback(owner: LightTickOwner): Promise<LightTickReadingFeedbackRow[]>;
  listReadingGuides(owner: LightTickOwner): Promise<LightTickReadingGuideRow[]>;
  saveReadingDaily(rows: LightTickReadingDailyRow[]): Promise<LightTickReadingDailyRow[]>;
}
