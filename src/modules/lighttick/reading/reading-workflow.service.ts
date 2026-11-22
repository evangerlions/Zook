import { createHash } from "node:crypto";
import { ApplicationError } from "../../../shared/errors.ts";
import { randomId } from "../../../shared/utils.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { ReadingService, normalizeUrl } from "./reading.service.ts";
import { fetchReadingFeed, feedUrl, parseReadingFeed } from "./reading-feed.ts";
import type {
  ReadingSource,
  ReadingCollection,
  ReadingTask,
  FeedCandidate,
} from "./reading-workflow.types.ts";
const invalid = (message: string) =>
  new ApplicationError(400, "REQ_FIELD_INVALID", message);
const missing = () =>
  new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "阅读内容不存在。");
const conflict = (message = "内容已变化，请刷新后重试。") =>
  new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", message);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const text = (v: unknown, max: number, required = false) => {
  if (typeof v !== "string" || v.trim().length > max || (required && !v.trim()))
    throw invalid("文本为空或超出长度限制。");
  return v.trim();
};
const defaults: ReadingSource[] = [
  {
    id: "default_owid",
    name: "Our World in Data",
    url: "https://ourworldindata.org/atom.xml",
    language: "en",
    topics: ["社会", "认知"],
  },
  {
    id: "default_wbw",
    name: "Wait But Why",
    url: "https://waitbutwhy.com/feed",
    language: "en",
    topics: ["成长", "认知"],
  },
  {
    id: "default_ruanyifeng",
    name: "阮一峰的网络日志",
    url: "https://www.ruanyifeng.com/blog/atom.xml",
    language: "zh",
    topics: ["科技", "成长"],
  },
].map(
  (s) =>
    ({
      ...s,
      revision: 1,
      custom: false,
      enabled: true,
      updated_at: "2026-11-14T00:00:00.000Z",
    }) as ReadingSource,
);
export class ReadingWorkflowService {
  constructor(
    private readonly repository: LightTickRepository,
    private readonly fetchFeed = fetchReadingFeed,
    private readonly clock = () => new Date(),
  ) {}
  private now() {
    return this.clock().toISOString();
  }
  async setup(owner: LightTickOwner) {
    const custom = await this.repository.listReadingEntries(owner, "source");
    const overrides = new Map(custom.map((s) => [s.id, s]));
    return {
      sources: [
        ...defaults.map((s) => overrides.get(s.id) ?? s),
        ...custom.filter((s) => s.custom),
      ],
    };
  }
  async addSource(owner: LightTickOwner, input: Record<string, unknown>) {
    const name = text(input.name, 100, true);
    let url: string;
    try {
      url = feedUrl(text(input.url, 1500, true)).href;
    } catch {
      throw invalid("请输入公开的 HTTPS RSS / Atom 地址。");
    }
    if (!["zh", "en"].includes(String(input.language)))
      throw invalid("来源语言必须为 zh 或 en。");
    if (!Array.isArray(input.topics) || input.topics.length > 10)
      throw invalid("主题最多 10 个。");
    const topics = input.topics.map((v) => text(v, 60, true));
    return this.repository.transaction(owner, async () => {
      const all = (await this.setup(owner)).sources;
      const duplicate = all.find(
        (s) => normalizeUrl(s.url) === normalizeUrl(url),
      );
      if (duplicate) return duplicate;
      if (all.filter((s) => s.custom).length >= 20)
        throw invalid("自定义来源最多 20 个，请先删除不用的来源。");
      const source: ReadingSource = {
        id: randomId("reading_source"),
        revision: 1,
        name,
        url,
        language: input.language as "zh" | "en",
        topics,
        custom: true,
        enabled: true,
        updated_at: this.now(),
      };
      await this.repository.saveReadingEntry(owner, "source", source);
      return source;
    });
  }
  async changeSource(
    owner: LightTickOwner,
    id: string,
    input: Record<string, unknown>,
    remove = false,
  ) {
    return this.repository.transaction(owner, async () => {
      const source = (await this.setup(owner)).sources.find((s) => s.id === id);
      if (!source) throw missing();
      if (input.base_version !== source.revision) throw conflict();
      if (remove) {
        if (!source.custom) throw invalid("推荐来源可以停用。");
        await this.repository.deleteReadingEntry(owner, "source", id);
        return { deleted: true };
      }
      if (typeof input.enabled !== "boolean")
        throw invalid("enabled 必须为布尔值。");
      const next = {
        ...source,
        enabled: input.enabled,
        revision: source.revision + 1,
        updated_at: this.now(),
      };
      await this.repository.saveReadingEntry(owner, "source", next);
      return next;
    });
  }
  async history(owner: LightTickOwner) {
    return {
      items: (
        await this.repository.listReadingEntries(owner, "collection", {
          limit: 50,
        })
      )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 50),
    };
  }
  async collect(owner: LightTickOwner, input: Record<string, unknown>) {
    const id = text(input.request_key, 100, true);
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw invalid("request_key 无效。");
    if (
      !Array.isArray(input.source_ids) ||
      input.source_ids.length < 1 ||
      input.source_ids.length > 3 ||
      input.source_ids.some((s) => typeof s !== "string")
    )
      throw invalid("一次选择 1 至 3 个来源。");
    const ids = [...new Set(input.source_ids as string[])].sort();
    const q = text(input.q ?? "", 100);
    const language = input.language ?? "all";
    if (!["all", "zh", "en"].includes(String(language)))
      throw invalid("语言无效。");
    const requestHash = hash(JSON.stringify({ ids, q, language }));
    const previous = await this.repository.getReadingEntry(
      owner,
      "collection",
      id,
    );
    if (previous) {
      if (previous.request_hash !== requestHash)
        throw conflict("请求编号已用于其他搜集条件。");
      return previous;
    }
    const available = (await this.setup(owner)).sources;
    const selected = ids.map((id) =>
      available.find((s) => s.id === id && s.enabled),
    );
    if (selected.some((s) => !s)) throw invalid("来源不存在或已停用。");
    const candidates: FeedCandidate[] = [];
    const sources: ReadingCollection["sources"] = [];
    const seen = new Set<string>();
    const deadline = Date.now() + 18000;
    for (const source of selected as ReadingSource[]) {
      try {
        const parsed = parseReadingFeed(
          await this.fetchFeed(source.url, deadline),
          source.url,
        );
        let count = 0;
        for (const item of parsed) {
          if (
            (language !== "all" && source.language !== language) ||
            (q &&
              !`${item.title} ${item.summary} ${source.topics.join(" ")}`
                .toLowerCase()
                .includes(q.toLowerCase()))
          )
            continue;
          if (seen.has(item.url)) continue;
          seen.add(item.url);
          candidates.push({
            ...item,
            source: source.name,
            language: source.language,
            topic: source.topics[0] ?? "",
          });
          count++;
        }
        sources.push({ id: source.id, name: source.name, count });
      } catch {
        sources.push({
          id: source.id,
          name: source.name,
          count: 0,
          error: "来源读取失败，请稍后重试。",
        });
      }
    }
    const collection: ReadingCollection = {
      id,
      revision: 1,
      request_hash: requestHash,
      status: sources.every((s) => s.error) ? "failed" : "ready",
      candidates: candidates.slice(0, 60),
      sources,
      updated_at: this.now(),
    };
    return this.repository.transaction(owner, async () => {
      const raced = await this.repository.getReadingEntry(
        owner,
        "collection",
        id,
      );
      if (raced) {
        if (raced.request_hash !== requestHash) throw conflict();
        return raced;
      }
      await this.repository.saveReadingEntry(owner, "collection", collection);
      return collection;
    });
  }
  async saveCandidate(
    owner: LightTickOwner,
    collectionId: string,
    candidateId: string,
  ) {
    return this.repository.transaction(owner, async () => {
      const collection = await this.repository.getReadingEntry(
        owner,
        "collection",
        collectionId,
      );
      const candidate = collection?.candidates.find(
        (c) => c.id === candidateId,
      );
      if (!collection || !candidate) throw missing();
      const result = await new ReadingService(
        this.repository,
        this.clock,
      ).create(owner, {
        url: candidate.url,
        title: candidate.title,
        summary: candidate.summary,
        source: candidate.source,
        language: candidate.language,
        topic: candidate.topic,
        body_kind: "none",
      });
      candidate.saved_article_id = result.article.id;
      collection.revision++;
      collection.updated_at = this.now();
      await this.repository.saveReadingEntry(owner, "collection", collection);
      return result;
    });
  }
  private async date(owner: LightTickOwner) {
    return businessDateAt(
      this.clock(),
      (await this.repository.getProfile(owner))?.timezone ?? "UTC",
    );
  }
  async tasks(owner: LightTickOwner) {
    const date = await this.date(owner);
    return {
      business_date: date,
      items: (
        await this.repository.listReadingEntries(owner, "task", {
          businessDate: date,
        })
      ).filter((t) => t.business_date === date),
    };
  }
  async schedule(owner: LightTickOwner, articleId: string) {
    return this.repository.transaction(owner, async () => {
      const article = await this.repository.getReadingArticle(owner, articleId);
      if (!article) throw missing();
      const date = await this.date(owner);
      const id = `reading_task_${hash(`${articleId}:${date}`).slice(0, 24)}`;
      const previous = await this.repository.getReadingEntry(owner, "task", id);
      if (previous && previous.status !== "cancelled") return previous;
      const task: ReadingTask = {
        id,
        article_id: articleId,
        title: article.title,
        business_date: date,
        status: "pending",
        revision: (previous?.revision ?? 0) + 1,
        updated_at: this.now(),
      };
      await this.repository.saveReadingEntry(owner, "task", task);
      return task;
    });
  }
  async saveState(
    owner: LightTickOwner,
    articleId: string,
    input: Record<string, unknown>,
  ) {
    return this.repository.transaction(owner, async () => {
      const state = await new ReadingService(
        this.repository,
        this.clock,
      ).saveState(owner, articleId, input);
      if (input.completed === true) {
        const date = await this.date(owner);
        for (const task of await this.repository.listReadingEntries(
          owner,
          "task",
          { businessDate: date },
        )) {
          if (
            task.article_id === articleId &&
            task.business_date === date &&
            ["pending", "in_progress"].includes(task.status)
          )
            await this.repository.saveReadingEntry(owner, "task", {
              ...task,
              status: "completed",
              revision: task.revision + 1,
              updated_at: this.now(),
            });
        }
      }
      return state;
    });
  }
  async command(
    owner: LightTickOwner,
    id: string,
    input: Record<string, unknown>,
  ) {
    return this.repository.transaction(owner, async () => {
      const task = await this.repository.getReadingEntry(owner, "task", id);
      if (!task) throw missing();
      if (input.base_version !== task.revision) throw conflict();
      const action = input.action;
      if (!["start", "complete", "cancel"].includes(String(action)))
        throw invalid("阅读任务操作无效。");
      if (["completed", "cancelled"].includes(task.status))
        throw conflict("该阅读任务已经结束。");
      if (action === "complete") {
        const state = await this.repository.getReadingState(
          owner,
          task.article_id,
        );
        await new ReadingService(this.repository, this.clock).saveState(
          owner,
          task.article_id,
          {
            base_version: state?.revision ?? 0,
            position_ratio: state?.positionRatio ?? 0,
            completed: true,
          },
        );
      }
      const next: ReadingTask = {
        ...task,
        status:
          action === "start"
            ? "in_progress"
            : action === "complete"
              ? "completed"
              : "cancelled",
        revision: task.revision + 1,
        updated_at: this.now(),
      };
      await this.repository.saveReadingEntry(owner, "task", next);
      return next;
    });
  }
}
