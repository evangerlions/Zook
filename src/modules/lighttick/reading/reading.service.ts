import { createHash } from "node:crypto";
import { ApplicationError } from "../../../shared/errors.ts";
import { randomId } from "../../../shared/utils.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { addDays } from "../growth/lighttick-growth.service.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type {
  LightTickReadingArticleRow, LightTickReadingFeedbackRow, LightTickReadingGuideRow,
  LightTickReadingStateRow, ReadingBodyKind, ReadingLanguage,
} from "./reading.types.ts";

/**
 * 阅读域服务。
 *
 * 三条口径是这一域的全部难点，都写在这里而不是散在路由里：
 * 1. **判重**：URL 先规范化再哈希。同一个链接的 `?utm=…`、尾斜杠、大小写主机名不该变成两篇。
 * 2. **读完 ≠ 滚到底**：只有显式 `completed` 才写 `completedAt`，`positionRatio=100` 不推断。
 * 3. **每日选文落库**：库会在一天内变化（新增文章、读完一篇），现算保证不了「同一天三次打开是同一组」。
 */

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|yclid$|msclkid$|spm$|ref$|ref_src$|ref_url$|share_|from$|source$)/;
const MAX_ARTICLES = 2000;

export function normalizeUrl(input: string): string {
  const raw = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "请输入完整的 http/https 链接。");
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "只支持 http/https 链接。");
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443"))
    parsed.port = "";
  const keep: Array<[string, string]> = [];
  for (const [key, value] of parsed.searchParams.entries())
    if (!TRACKING_PARAMS.test(key.toLowerCase())) keep.push([key, value]);
  keep.sort(([a], [b]) => a.localeCompare(b));
  parsed.search = "";
  for (const [key, value] of keep) parsed.searchParams.append(key, value);
  // 尾斜杠要在序列化之前从 pathname 去掉，否则带查询串时 endsWith('/') 永远为假。
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/"))
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}

export function urlHashOf(url: string): string {
  return createHash("sha256").update(normalizeUrl(url)).digest("hex");
}

export interface ReadingCandidate {
  id: string;
  topic: string;
}

export interface DailyPick {
  ordinal: number;
  articleId: string;
  reason: string;
}

/**
 * 每日选文：先按主题轮转保证覆盖，再在已覆盖主题里补位保证探索。
 * 排序用 `${businessDate}:${id}` 的哈希，所以同一业务日、同一候选池，结果稳定；
 * 结果仍会落库，因为候选池本身会在一天内变化。
 */
export function pickDaily(
  candidates: ReadingCandidate[],
  recentArticleIds: Set<string>,
  businessDate: string,
  limit = 3,
): DailyPick[] {
  const pool = candidates.filter((item) => !recentArticleIds.has(item.id));
  if (!pool.length) return [];
  const rank = (item: ReadingCandidate) =>
    createHash("sha256").update(`${businessDate}:${item.id}`).digest("hex");
  const byTopic = new Map<string, ReadingCandidate[]>();
  for (const item of [...pool].sort((a, b) => rank(a).localeCompare(rank(b)))) {
    const key = item.topic.trim();
    byTopic.set(key, [...(byTopic.get(key) ?? []), item]);
  }
  const topics = [...byTopic.keys()].sort();
  const picks: DailyPick[] = [];
  let round = 0;
  while (picks.length < limit) {
    let taken = false;
    for (const topic of topics) {
      if (picks.length >= limit) break;
      const queue = byTopic.get(topic)!;
      const next = queue.shift();
      if (!next) continue;
      taken = true;
      picks.push({
        ordinal: picks.length + 1,
        articleId: next.id,
        reason: round === 0 ? `主题覆盖：${topic || "未分类"}` : `探索：${topic || "未分类"}`,
      });
    }
    if (!taken) break;
    round += 1;
  }
  return picks;
}

export function feedbackHasContent(feedback: LightTickReadingFeedbackRow | undefined): boolean {
  if (!feedback) return false;
  return feedback.valueRating !== null || feedback.difficulty !== null ||
    feedback.takeaway.trim().length > 0 || feedback.question.trim().length > 0 ||
    feedback.application.trim().length > 0 || feedback.tags.length > 0;
}

function haystack(
  article: LightTickReadingArticleRow,
  guide?: LightTickReadingGuideRow,
  feedback?: LightTickReadingFeedbackRow,
): string {
  return [
    article.title, article.source, article.summary, article.body, article.topic,
    ...(guide ? [...guide.corePoints, ...guide.evidenceLimits, ...guide.languageNotes, ...guide.applicationQuestions] : []),
    ...(feedback ? [feedback.takeaway, feedback.question, feedback.application, ...feedback.tags] : []),
  ].join("\n").toLowerCase();
}

function text(value: unknown, field: string, max: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", `${field}不能为空。`);
    return "";
  }
  if (typeof value !== "string")
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", `${field}必须是文本。`);
  const trimmed = value.trim();
  if (required && !trimmed)
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", `${field}不能为空。`);
  if (trimmed.length > max)
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", `${field}最多 ${max} 字。`);
  return trimmed;
}

function rating(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 5)
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", `${field}应为 1–5 的整数。`);
  return value as number;
}

function tagsOf(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "标签必须是文本数组。");
  const unique = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (unique.length > 12)
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "标签最多 12 个。");
  if (unique.some((item) => item.length > 24))
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "单个标签最多 24 字。");
  return unique;
}

function bodyKindOf(body: string, declared: unknown): ReadingBodyKind {
  if (declared === undefined || declared === null)
    return body ? "excerpt" : "none";
  if (!["full", "excerpt", "none"].includes(String(declared)))
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "body_kind 只能是 full / excerpt / none。");
  if (declared !== "none" && !body)
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "声明有正文时正文不能为空。");
  if (declared === "none" && body)
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "有正文时 body_kind 不能是 none。");
  return declared as ReadingBodyKind;
}

export class ReadingService {
  constructor(
    private readonly repository: LightTickRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly assertActive: () => Promise<void> = async () => {},
  ) {}

  private async timezone(owner: LightTickOwner): Promise<string> {
    return (await this.repository.getProfile(owner))?.timezone ?? "UTC";
  }

  private async article(owner: LightTickOwner, id: string): Promise<LightTickReadingArticleRow> {
    const article = await this.repository.getReadingArticle(owner, id);
    if (!article)
      throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Reading article was not found.");
    return article;
  }

  /** 行 → 接口形态。create / update / detail 必须同一套，否则前端会看到两种字段名。 */
  private detailOf(article: LightTickReadingArticleRow) {
    return {
      id: article.id, url: article.url, title: article.title, source: article.source,
      language: article.language, topic: article.topic, summary: article.summary,
      body: article.body, body_kind: article.bodyKind, revision: article.revision,
      created_at: article.createdAt, updated_at: article.updatedAt,
    };
  }

  async create(owner: LightTickOwner, input: Record<string, unknown>) {
    await this.assertActive();
    const url = text(input.url, "链接", 1500, true);
    const urlHash = urlHashOf(url);
    const existing = await this.repository.findReadingArticleByUrlHash(owner, urlHash);
    // 同一链接重复添加不是错误：把已有那篇原样交回，界面据此提示「已在库里」。
    if (existing) return { article: this.detailOf(existing), duplicate: true as const };

    const body = text(input.body, "正文", 200_000);
    const now = this.clock().toISOString();
    const language = String(input.language ?? "zh");
    if (!["zh", "en"].includes(language))
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "language 只能是 zh 或 en。");
    const article = await this.repository.saveReadingArticle({
      appId: owner.appId, userId: owner.userId, id: randomId("lighttick_article"),
      url, urlHash,
      title: text(input.title, "标题", 300, true),
      source: text(input.source, "来源", 200),
      language: language as ReadingLanguage,
      topic: text(input.topic, "主题", 60),
      summary: text(input.summary, "摘要", 4000),
      body,
      bodyKind: bodyKindOf(body, input.body_kind),
      revision: 1, createdAt: now, updatedAt: now,
    });
    return { article: this.detailOf(article), duplicate: false as const };
  }

  async list(owner: LightTickOwner, query: { q?: string; filter?: string; topic?: string } = {}) {
    const [articles, states, feedbacks, guides] = await Promise.all([
      this.repository.listReadingArticles(owner),
      this.repository.listReadingStates(owner),
      this.repository.listReadingFeedback(owner),
      this.repository.listReadingGuides(owner),
    ]);
    if (articles.length > MAX_ARTICLES)
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "文章数量超出当前上限，请先归档。");
    const stateOf = new Map(states.map((row) => [row.articleId, row]));
    const feedbackOf = new Map(feedbacks.map((row) => [row.articleId, row]));
    const guideOf = new Map(guides.map((row) => [row.articleId, row]));
    const needle = (query.q ?? "").trim().toLowerCase();
    const filter = query.filter ?? "all";
    if (!["all", "with_feedback", "unread", "read"].includes(filter))
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "filter 只能是 all / with_feedback / unread / read。");
    const topic = (query.topic ?? "").trim();

    const items = articles
      .filter((article) => {
        const state = stateOf.get(article.id);
        const feedback = feedbackOf.get(article.id);
        if (topic && article.topic !== topic) return false;
        if (filter === "read" && !state?.completedAt) return false;
        if (filter === "unread" && state?.completedAt) return false;
        if (filter === "with_feedback" && !feedbackHasContent(feedback)) return false;
        if (needle && !haystack(article, guideOf.get(article.id), feedback).includes(needle)) return false;
        return true;
      })
      .map((article) => this.summaryOf(article, stateOf.get(article.id), feedbackOf.get(article.id), guideOf.get(article.id)));
    return { items, total: items.length };
  }

  private summaryOf(
    article: LightTickReadingArticleRow,
    state?: LightTickReadingStateRow,
    feedback?: LightTickReadingFeedbackRow,
    guide?: LightTickReadingGuideRow,
  ) {
    return {
      id: article.id, url: article.url, title: article.title, source: article.source,
      language: article.language, topic: article.topic, summary: article.summary,
      body_kind: article.bodyKind, revision: article.revision,
      created_at: article.createdAt, updated_at: article.updatedAt,
      position_ratio: state?.positionRatio ?? 0,
      completed_at: state?.completedAt ?? null,
      has_guide: !!guide, guide_basis: guide?.basis ?? null,
      has_feedback: feedbackHasContent(feedback),
      tags: feedback?.tags ?? [],
      value_rating: feedback?.valueRating ?? null,
      difficulty: feedback?.difficulty ?? null,
    };
  }

  async detail(owner: LightTickOwner, id: string) {
    const article = await this.article(owner, id);
    const [guide, state, feedback] = await Promise.all([
      this.repository.getReadingGuide(owner, id),
      this.repository.getReadingState(owner, id),
      this.repository.getReadingFeedback(owner, id),
    ]);
    return {
      article: this.detailOf(article),
      guide: guide ? {
        basis: guide.basis, core_points: guide.corePoints, evidence_limits: guide.evidenceLimits,
        language_notes: guide.languageNotes, application_questions: guide.applicationQuestions,
        model: guide.model, revision: guide.revision, generated_at: guide.generatedAt,
      } : null,
      state: {
        position_ratio: state?.positionRatio ?? 0,
        position_anchor: state?.positionAnchor ?? "",
        completed_at: state?.completedAt ?? null,
        revision: state?.revision ?? 0,
      },
      feedback: feedback ? {
        value_rating: feedback.valueRating, difficulty: feedback.difficulty,
        takeaway: feedback.takeaway, question: feedback.question, application: feedback.application,
        tags: feedback.tags, revision: feedback.revision, updated_at: feedback.updatedAt,
      } : null,
    };
  }

  async update(owner: LightTickOwner, id: string, input: Record<string, unknown>) {
    await this.assertActive();
    const current = await this.article(owner, id);
    const base = input.base_version;
    if (!Number.isInteger(base))
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "base_version 必须是整数。");
    const body = input.body === undefined ? current.body : text(input.body, "正文", 200_000);
    const url = input.url === undefined ? current.url : text(input.url, "链接", 1500, true);
    const urlHash = input.url === undefined ? current.urlHash : urlHashOf(url);
    if (urlHash !== current.urlHash && await this.repository.findReadingArticleByUrlHash(owner, urlHash))
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "这个链接已经在库里。");
    const language = String(input.language ?? current.language);
    if (!["zh", "en"].includes(language))
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "language 只能是 zh 或 en。");
    const saved = await this.repository.saveReadingArticle({
      ...current,
      url, urlHash,
      title: input.title === undefined ? current.title : text(input.title, "标题", 300, true),
      source: input.source === undefined ? current.source : text(input.source, "来源", 200),
      language: language as ReadingLanguage,
      topic: input.topic === undefined ? current.topic : text(input.topic, "主题", 60),
      summary: input.summary === undefined ? current.summary : text(input.summary, "摘要", 4000),
      body,
      bodyKind: bodyKindOf(body, input.body_kind ?? current.bodyKind),
      updatedAt: this.clock().toISOString(),
    }, base as number);
    return this.detailOf(saved);
  }

  async remove(owner: LightTickOwner, id: string) {
    await this.assertActive();
    await this.article(owner, id);
    await this.repository.deleteReadingArticle(owner, id);
    return { id };
  }

  /** 位置与读完共用一次 CAS，但读完必须显式传 completed，不从 position 推断。 */
  async saveState(owner: LightTickOwner, id: string, input: Record<string, unknown>) {
    await this.assertActive();
    await this.article(owner, id);
    const current = await this.repository.getReadingState(owner, id);
    const base = input.base_version;
    if (!Number.isInteger(base))
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "base_version 必须是整数。");
    if (base !== (current?.revision ?? 0))
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "阅读位置已变化，请保留输入后重新读取。");
    const ratio = input.position_ratio === undefined ? (current?.positionRatio ?? 0) : input.position_ratio;
    if (!Number.isInteger(ratio) || (ratio as number) < 0 || (ratio as number) > 100)
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "position_ratio 应为 0–100 的整数。");
    if (input.completed !== undefined && typeof input.completed !== "boolean")
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "completed 必须是布尔值。");
    const now = this.clock().toISOString();
    const completedAt = input.completed === true
      ? (current?.completedAt ?? now)
      : input.completed === false ? null : (current?.completedAt ?? null);
    const saved = await this.repository.saveReadingState({
      appId: owner.appId, userId: owner.userId, articleId: id,
      positionRatio: ratio as number,
      positionAnchor: input.position_anchor === undefined
        ? (current?.positionAnchor ?? "")
        : text(input.position_anchor, "位置锚点", 200),
      completedAt, revision: current?.revision ?? 1, updatedAt: now,
    }, current ? current.revision : undefined);
    return {
      position_ratio: saved.positionRatio, position_anchor: saved.positionAnchor,
      completed_at: saved.completedAt, revision: saved.revision,
    };
  }

  async saveFeedback(owner: LightTickOwner, id: string, input: Record<string, unknown>) {
    await this.assertActive();
    await this.article(owner, id);
    const current = await this.repository.getReadingFeedback(owner, id);
    const base = input.base_version;
    if (!Number.isInteger(base))
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "base_version 必须是整数。");
    if (base !== (current?.revision ?? 0))
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "反馈已变化，请保留输入后重新读取。");
    const saved = await this.repository.saveReadingFeedback({
      appId: owner.appId, userId: owner.userId, articleId: id,
      valueRating: input.value_rating === undefined ? (current?.valueRating ?? null) : rating(input.value_rating, "价值评分"),
      difficulty: input.difficulty === undefined ? (current?.difficulty ?? null) : rating(input.difficulty, "难度"),
      takeaway: input.takeaway === undefined ? (current?.takeaway ?? "") : text(input.takeaway, "收获", 4000),
      question: input.question === undefined ? (current?.question ?? "") : text(input.question, "疑问", 2000),
      application: input.application === undefined ? (current?.application ?? "") : text(input.application, "应用行动", 2000),
      tags: input.tags === undefined ? (current?.tags ?? []) : tagsOf(input.tags),
      revision: current?.revision ?? 1, updatedAt: this.clock().toISOString(),
    }, current ? current.revision : undefined);
    return {
      value_rating: saved.valueRating, difficulty: saved.difficulty, takeaway: saved.takeaway,
      question: saved.question, application: saved.application, tags: saved.tags,
      revision: saved.revision, updated_at: saved.updatedAt,
    };
  }

  /**
   * 今日选文。已存过就原样返回——这是「固定编号」的全部意义。
   * 候选池 = 本人未读完的文章，排除近 7 天已推荐过的；不足 3 篇就少给，不拿读过的凑数。
   */
  async daily(owner: LightTickOwner, date?: string) {
    const timezone = await this.timezone(owner);
    const businessDate = date ?? businessDateAt(this.clock(), timezone);
    const stored = await this.repository.listReadingDaily(owner, businessDate);
    const [articles, states] = await Promise.all([
      this.repository.listReadingArticles(owner),
      this.repository.listReadingStates(owner),
    ]);
    const articleOf = new Map(articles.map((row) => [row.id, row]));
    const completed = new Set(states.filter((row) => row.completedAt).map((row) => row.articleId));

    let picks = stored;
    if (!picks.length) {
      const recent = await this.repository.listReadingDailySince(owner, addDays(businessDate, -7));
      const candidates: ReadingCandidate[] = articles
        .filter((article) => !completed.has(article.id))
        .map((article) => ({ id: article.id, topic: article.topic }));
      const planned = pickDaily(candidates, new Set(recent.map((row) => row.articleId)), businessDate);
      if (planned.length) {
        const now = this.clock().toISOString();
        await this.repository.saveReadingDaily(planned.map((pick) => ({
          appId: owner.appId, userId: owner.userId, businessDate,
          ordinal: pick.ordinal, articleId: pick.articleId, reason: pick.reason, createdAt: now,
        })));
        picks = await this.repository.listReadingDaily(owner, businessDate);
      }
    }

    const items = picks
      .map((pick) => {
        const article = articleOf.get(pick.articleId);
        if (!article) return null;
        return {
          ordinal: pick.ordinal, reason: pick.reason,
          id: article.id, url: article.url, title: article.title, source: article.source,
          language: article.language, topic: article.topic, summary: article.summary,
          body_kind: article.bodyKind, completed: completed.has(article.id),
        };
      })
      .filter((item) => item !== null);
    return {
      business_date: businessDate, timezone,
      items,
      // 候选池不足时如实说明，而不是悄悄拿读过的文章补位。
      shortfall: Math.max(0, 3 - items.length),
    };
  }

  /** 供下一步的导读生成复用：写入导读前必须先判断依据是全文还是只有摘要。 */
  async guideBasis(owner: LightTickOwner, id: string): Promise<"full_text" | "summary"> {
    const article = await this.article(owner, id);
    return article.bodyKind === "full" ? "full_text" : "summary";
  }

  /** 未读文章数，供今日页入口显示，避免点进去才发现是空的。 */
  async unreadCount(owner: LightTickOwner): Promise<number> {
    const [articles, states] = await Promise.all([
      this.repository.listReadingArticles(owner),
      this.repository.listReadingStates(owner),
    ]);
    const completed = new Set(states.filter((row) => row.completedAt).map((row) => row.articleId));
    return articles.filter((article) => !completed.has(article.id)).length;
  }
}
