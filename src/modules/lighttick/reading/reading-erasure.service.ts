import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { articleId } from "./reading.validation.ts";
import {
  digest,
  fail,
  integer,
  keys,
  object,
} from "../learning/native-learning.validation.ts";
import { ApplicationError } from "../../../shared/errors.ts";
export function assertReadingNotErased(result: Record<string, unknown>) {
  if (result.erased === true)
    throw new ApplicationError(
      410,
      "LIGHTTICK_READING_ERASED",
      "原请求的私人内容已删除；输入仍保留，请核对后结束此原请求。",
    );
}
export class ReadingErasureService {
  constructor(
    readonly repo: LightTickRepository,
    readonly authorize: () => Promise<void> = async () => {},
    readonly clock = () => new Date(),
  ) {}
  async preview(o: LightTickOwner, id: string) {
    articleId(id);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      return (await this.scope(o, id)).preview;
    });
  }
  private async scope(o: LightTickOwner, id: string) {
    const article = await this.repo.reading.get(o, id);
    if (!article) {
      if (await this.repo.readingErasure.tombstone(o, id))
        assertReadingNotErased({ erased: true });
      fail(404, "未找到本人的文章。");
    }
    const jobs = await this.repo.readingErasure.related(o, article);
    if (jobs.length > 100)
      fail(413, "关联任务超过100项，请分领域整理后删除；尚未删除任何内容。");
    const vocabulary = (await this.repo.reading.listVocabulary(o))
        .filter((w) => w.article_id === id)
        .map((w) => ({ id: w.id, revision: w.revision }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
      targets = {
        article_id: id,
        work_ids: jobs.map((w) => w.id),
        vocabulary_ids: vocabulary.map((w) => w.id),
      },
      receipts = await this.repo.readingErasure.receipts(o, targets),
      backups = (await this.repo.readingBackups.list(o)).map((b) => ({
        id: b.id,
        manifest_sha256: b.manifest_sha256,
      }));
    if (vocabulary.length > 10000)
      fail(413, "关联生词超过10000项；尚未删除任何内容。");
    if (receipts.length > 10000)
      fail(413, "关联原请求超过10000项；尚未删除任何内容。");
    const work = [];
    for (const w of jobs)
      work.push({
        id: w.id,
        revision: w.revision,
        status: w.status,
        assets: (await this.repo.readingWork.assets.list(o, w.id)).map((a) => ({
          id: a.id,
          sha256: a.sha256,
        })),
        other_article_ids: [
          ...new Set(
            Object.values(w.adopted)
              .map((a) => a.article_id)
              .filter((a) => a !== id),
          ),
        ].sort(),
      });
    if (
      work.some(
        (w) => w.assets.length > 100 || w.other_article_ids.length > 100,
      )
    )
      fail(413, "共享任务范围超过容量；尚未删除任何内容。");
    const versions = await this.repo.readingErasure.versionCount(o, id);
    if (versions > 10000) fail(413, "文章历史超过10000项；尚未删除任何内容。");
    const facts = {
        article_id: id,
        base_revision: article.revision,
        content_version: article.content_version,
        article_versions: versions,
        work,
        vocabulary,
        receipts,
        backups,
      },
      preview = {
        ...facts,
        scope_digest: digest(facts),
        preserved: [
          "independent_articles",
          "actions_and_feedback",
          "knowledge_notes",
          "previously_downloaded_user_copies",
        ],
      };
    return { article, jobs, targets, preview };
  }
  async receipt(o: LightTickOwner, key: string) {
    this.key(key);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const op = await this.repo.getOperation(o, key);
      if (!op || op.entityType !== "reading_erasure")
        fail(404, "未找到此删除原请求。");
      return {
        operation_id: key,
        payload_hash: op.payloadHash,
        result: op.resultPayload,
      };
    });
  }
  private key(key: string) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key))
      fail(422, "请保留有效原请求编号。");
  }
  async erase(o: LightTickOwner, id: string, raw: unknown, key: string) {
    articleId(id);
    this.key(key);
    const body = structuredClone(object(raw));
    keys(body, ["base_revision", "content_version", "scope_digest"]);
    integer(body.base_revision, 1, 2147483646);
    if (
      !/^[a-f0-9]{64}$/.test(String(body.content_version)) ||
      !/^[a-f0-9]{64}$/.test(String(body.scope_digest))
    )
      fail(422, "请先核对完整删除范围。");
    const hash = digest({ id, action: "erase", body });
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const op = await this.repo.getOperation(o, key);
      if (op) {
        if (
          op.entityType !== "reading_erasure" ||
          op.entityId !== id ||
          op.payloadHash !== hash
        )
          fail(409, "原请求编号已用于其他操作。");
        return structuredClone(op.resultPayload);
      }
      const s = await this.scope(o, id);
      if (
        s.article.revision !== body.base_revision ||
        s.article.content_version !== body.content_version ||
        s.preview.scope_digest !== body.scope_digest
      )
        fail(409, "删除范围已变化；未删除任何内容，请重新核对。");
      const now = this.clock().toISOString(),
        tombstone = {
          id,
          revision: s.article.revision + 1,
          content_version: s.article.content_version,
          deleted: true as const,
          deleted_at: now,
        };
      // The owner lock fences workers; late callbacks cannot match this revision or lease.
      for (const w of s.jobs)
        await this.repo.readingWork.save(
          {
            ...w,
            revision: w.revision + 1,
            status: ["queued", "running"].includes(w.status)
              ? "cancelled"
              : w.status,
            input: {
              article_id: id,
              content_version: s.article.content_version,
            },
            output: null,
            fence: null,
            lease_until: null,
            error_code: "DATA_ERASED",
            ...(["queued", "running"].includes(w.status)
              ? { finished_at: now }
              : {}),
            updated_at: now,
          },
          w.revision,
        );
      await this.repo.readingErasure.erase(o, tombstone, s.targets);
      await this.repo.readingBackups.invalidate(o);
      const result = {
        ...tombstone,
        scope_digest: s.preview.scope_digest,
        removed: {
          article_versions: s.preview.article_versions,
          work: s.jobs.length,
          assets: s.preview.work.reduce((n, w) => n + w.assets.length, 0),
          vocabulary: s.targets.vocabulary_ids.length,
          receipts: s.preview.receipts.length,
          backups: s.preview.backups.length,
        },
      };
      await this.repo.saveOperation({
        ...o,
        operationId: key,
        deviceId: "reading-erasure",
        entityType: "reading_erasure",
        entityId: id,
        action: "erase",
        payloadHash: hash,
        requestPayload: body,
        resultPayload: result,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      return result;
    });
  }
}
