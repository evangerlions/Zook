import {assertReadingNotErased} from "./reading-erasure.service.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import {
  digest,
  fail,
  integer,
  keys,
  object,
  text,
} from "../learning/native-learning.validation.ts";
import { articleId } from "./reading.validation.ts";
import type { VocabularyEntry, VocabularyReview } from "./vocabulary.types.ts";

const intervals = [1, 3, 7, 14, 30];
const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function reviewDate(now: Date, step: number) {
  return day.format(new Date(now.getTime() + intervals[step] * 86_400_000));
}
function validId(id: string) {
  if (!/^vocab-[a-zA-Z0-9_-]{1,120}$/.test(id)) fail(422, "词条编号无效。");
}

export class VocabularyService {
  constructor(
    readonly repo: LightTickRepository,
    readonly authorize: () => Promise<void> = async () => {},
    readonly clock = () => new Date(),
  ) {}

  async list(
    owner: LightTickOwner,
    query: Record<string, string | undefined> = {},
  ) {
    const article = query.article_id;
    if (article) articleId(article);
    const filter = query.filter ?? "active";
    if (!["active", "due", "paused", "archived", "all"].includes(filter))
      fail(422, "词条筛选无效。");
    return this.repo.transaction(owner, async () => {
      await this.authorize();
      const today = day.format(this.clock());
      const cursor = query.cursor
        ? await this.repo.independentReading.getVocabulary(owner, query.cursor)
        : undefined;
      if (query.cursor && !cursor) fail(409, "词表已变化，请从首批重新核对。");
      if (
        cursor &&
        ((article && cursor.article_id !== article) ||
          (filter === "due" &&
            (cursor.archived || cursor.paused || cursor.next_review > today)) ||
          (filter === "active" && cursor.archived) ||
          (filter === "paused" && (!cursor.paused || cursor.archived)) ||
          (filter === "archived" && !cursor.archived))
      )
        fail(409, "词表筛选已变化，请从首批重新核对。");
      const limit =
        query.limit === undefined ? 50 : integer(Number(query.limit), 1, 100);
      const result = await this.repo.independentReading.vocabularyPage(owner, {
        article_id: article ?? "",
        filter,
        today,
        after_id: cursor?.id ?? "",
        after_date: cursor?.next_review ?? "",
        limit: limit + 1,
      });
      const items = result.items.slice(0, limit);
      return {
        items,
        stats: result.stats,
        next_cursor: result.items.length > limit ? items.at(-1)!.id : null,
      };
    });
  }

  async read(owner: LightTickOwner, id: string) {
    validId(id);
    return this.repo.transaction(owner, async () => {
      await this.authorize();
      const entry = await this.repo.independentReading.getVocabulary(owner, id);
      if (!entry) fail(404, "未找到本人的词条。");
      return {
        entry,
        reviews: await this.repo.independentReading.listVocabularyReviews(owner, id),
      };
    });
  }

  async write(
    owner: LightTickOwner,
    id: string,
    action: string,
    raw: unknown,
    key: string,
  ) {
    validId(id);
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) fail(422, "原请求编号无效。");
    const body = structuredClone(object(raw));
    const base = integer(body.base_revision, 0, 2147483646);
    const hash = digest({ id, action, body });
    return this.repo.transaction(owner, async () => {
      await this.authorize();
      const receipt = await this.repo.getOperation(owner, key);
      if (receipt) {
        if (
          receipt.entityType !== "reading_vocabulary" ||
          receipt.entityId !== id ||
          receipt.payloadHash !== hash
        )
          fail(409, "原请求编号已用于不同操作。");
        assertReadingNotErased(receipt.resultPayload);
        return receipt.resultPayload;
      }
      const previous = await this.repo.independentReading.getVocabulary(owner, id);
      if (
        (previous?.revision ?? 0) !== base ||
        (action === "add") === Boolean(previous)
      )
        fail(409, "词条已变化，请核对版本。");
      const now = this.clock();
      const timestamp = now.toISOString();
      let review: VocabularyReview | undefined;
      let result: Record<string, unknown>;
      if (action === "delete") {
        keys(body, ["base_revision"]);
        await this.repo.independentReading.deleteVocabulary(owner, id);
        result = { deleted: id };
      } else {
        let entry: VocabularyEntry;
        if (action === "add") {
          keys(body, [
            "base_revision",
            "word",
            "article_id",
            "source_version",
            "context_sentence",
            "contextual_meaning",
            "part_of_speech",
            "pronunciation",
          ]);
          const source = articleId(body.article_id);
          const article = await this.repo.independentReading.get(owner, source);
          if (!article || article.archived) fail(404, "未找到可用的本人文章。");
          if (article.content_version !== body.source_version)
            fail(409, "原文版本已变化。");
          const word = text(body.word, 200, true);
          if (!word.trim()) fail(422, "词条不能为空。");
          const normalized = word.trim().toLowerCase();
          if (
            await this.repo.independentReading.duplicateVocabulary(
              owner,
              source,
              normalized,
            )
          )
            fail(409, "该文章已保存这个词条。");
          if (await this.repo.independentReading.vocabularyIdUsed(owner, id))
            fail(409, "词条编号曾使用，请为新词条生成新编号。");
          entry = {
            id,
            revision: 1,
            word,
            normalized,
            article_id: source,
            source_version: article.content_version,
            context_sentence: text(body.context_sentence ?? "", 4000),
            contextual_meaning: text(body.contextual_meaning ?? "", 2000),
            part_of_speech: text(body.part_of_speech ?? "", 100),
            pronunciation: text(body.pronunciation ?? "", 200),
            step: 0,
            next_review: reviewDate(now, 0),
            paused: false,
            archived: false,
            created_at: timestamp,
            updated_at: timestamp,
          };
        } else {
          entry = { ...previous!, revision: base + 1, updated_at: timestamp };
          if (action === "review") {
            keys(body, ["base_revision", "feedback"]);
            const feedback = body.feedback;
            if (
              feedback !== "again" &&
              feedback !== "hard" &&
              feedback !== "good"
            )
              fail(422, "复习反馈无效。");
            if (entry.paused || entry.archived) fail(409, "请先恢复此词条。");
            const step =
              feedback === "again"
                ? 0
                : feedback === "hard"
                  ? entry.step
                  : Math.min(entry.step + 1, intervals.length - 1);
            review = {
              feedback,
              step_before: entry.step,
              step_after: step,
              reviewed_at: timestamp,
            };
            entry.step = step;
            entry.next_review = reviewDate(now, step);
          } else if (action === "pause" || action === "archive") {
            keys(body, ["base_revision", "value"]);
            if (typeof body.value !== "boolean") fail(422, "词条状态无效。");
            if (action === "pause") entry.paused = body.value;
            else entry.archived = body.value;
          } else {
            fail(422, "词条操作无效。");
          }
        }
        await this.repo.independentReading.saveVocabulary(owner, entry, review);
        result = { entry };
      }
      await this.repo.saveOperation({
        ...owner,
        operationId: key,
        deviceId: "reading-http",
        entityType: "reading_vocabulary",
        entityId: id,
        action,
        payloadHash: hash,
        requestPayload: body,
        resultPayload: result,
        status: "accepted",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return result;
    });
  }
}
