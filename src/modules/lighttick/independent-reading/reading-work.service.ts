import { freezeReadingAI } from "./reading-ai-snapshot.ts";
import { readingWorkEntry } from "./reading-work-entry.ts";
import { readingImportScope } from "./reading-import.ts";
import { articleContent } from "./reading.validation.ts";
import { assertReadingNotErased } from "./reading-erasure.service.ts";
import { adoptReadingWork } from "./reading-work-adoption.ts";
import { assertReadingJSON } from "./reading-json-safe.ts";
import { candidateReadingInput } from "./reading-candidate-input.ts";
import { readingSourceFields } from "./reading-source-fields.ts";
import type { JobQueue } from "../../../infrastructure/queue/job-queue.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type {
  ReadingWork,
  ReadingSource,
  ReadingWorkKind,
} from "./reading-work.types.ts";
import { captureModel } from "../personal-model/personal-model.service.ts";
import { ReadingService } from "./reading.service.ts";
import { writeReadingMaterial } from "./reading-materials.ts";
import {
  digest,
  fail,
  integer,
  keys,
  object,
  text,
  identity,
} from "../learning/native-learning.validation.ts";
export const READING_WORK_JOB = "lighttick.reading.work";
export { readingURL } from "./reading-url.ts";
import { readingURL } from "./reading-url.ts";
export class ReadingWorkService {
  constructor(
    readonly repo: LightTickRepository,
    readonly queue: JobQueue,
    readonly authorize: () => Promise<void> = async () => {},
    readonly clock = () => new Date(),
  ) {}
  get store() {
    return this.repo.readingWork;
  }
  data(row: ReadingWork) {
    const {
      appId: _,
      userId: __,
      input,
      fence: ___,
      lease_until: ____,
      ...data
    } = row;
    return {
      ...data,
      scope: {
        source_id: input.source_id ?? null,
        source_revision: input.source_revision ?? null,
        url: input.url ?? null,
        article_id: input.article_id ?? null,
        content_version: input.content_version ?? null,
        paragraph_id: input.paragraph_id ?? null,
        selected_characters: input.ai_context
          ? input.ai_context.source_range.end -
            input.ai_context.source_range.start
          : (input.text?.length ?? 0),
        ...(input.source_range ? { source_range: input.source_range } : {}),
        ...(input.ai_context
          ? {
              source_basis: input.ai_context.source_basis,
              source_units: "unicode_code_points",
              selected_bytes: input.ai_context.selected_bytes,
              input_sha256: input.ai_context.input_sha256,
              prompt_version: input.ai_context.prompt_version,
              prompt_sha256: input.ai_context.prompt_sha256,
              guide_format: input.ai_context.guide_format,
            }
          : {}),
        ...(input.recommendation
          ? {
              recommendation: input.recommendation.scope,
              ...(input.recommendation.automatic
                ? {
                    scheduled: {
                      date: input.recommendation.scope.date,
                      target_count:
                        input.recommendation.target_count ??
                        input.recommendation.scope.preferences.value.count,
                    },
                  }
                : {}),
            }
          : {}),
        ...(input.candidate_work_id
          ? {
              candidate_work_id: input.candidate_work_id,
              candidate_id: input.candidate_id,
              candidate_output_digest: input.candidate_output_digest,
            }
          : {}),
      },
      output_digest: row.output ? digest(row.output) : null,
    };
  }
  summary(row: ReadingWork) {
    const { output, ...data } = this.data(row);
    return { ...data, has_output: output !== null };
  }
  async asset(o: LightTickOwner, id: string, assetId: string) {
    identity(id, "readwork-");
    identity(assetId, "readasset-");
    return this.repo.transaction(o, async () => {
      await this.read(o, id);
      const row = await this.store.assets.get(o, id, assetId);
      if (!row) fail(404, "Reading asset not found");
      if (digest(row.value) !== row.sha256)
        fail(409, "Reading asset integrity check failed");
      return row;
    });
  }
  async assets(o: LightTickOwner, id: string) {
    identity(id, "readwork-");
    return this.repo.transaction(o, async () => {
      await this.read(o, id);
      return { items: await this.store.assets.list(o, id) };
    });
  }
  async command<T extends Record<string, any>>(
    o: LightTickOwner,
    id: string,
    action: string,
    b: Record<string, unknown>,
    key: string,
    perform: () => Promise<T>,
  ): Promise<T> {
    assertReadingJSON(b);
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key))
      fail(422, "请保留有效原请求编号。");
    const hash = digest({ id, action, b });
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const old = await this.repo.getOperation(o, key);
      if (old) {
        if (
          old.entityType !== "reading_work" ||
          old.entityId !== id ||
          old.payloadHash !== hash
        )
          fail(409, "原请求编号已用于其他操作。");
        assertReadingNotErased(old.resultPayload);
        return structuredClone(old.resultPayload) as T;
      }
      const result = await perform(),
        now = this.clock().toISOString();
      await this.repo.saveOperation({
        ...o,
        operationId: key,
        deviceId: "reading-work",
        entityType: "reading_work",
        entityId: id,
        action,
        payloadHash: hash,
        requestPayload: b,
        resultPayload: result,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      return result;
    });
  }
  async source(o: LightTickOwner, id: string) {
    identity(id, "source-");
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const row = await this.store.source(o, id);
      if (!row) fail(404, "未找到本人的阅读源。");
      return row;
    });
  }
  async sources(o: LightTickOwner, after = "") {
    if (after) identity(after, "source-");
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const rows = await this.store.sources(o, after, 51);
      return {
        items: rows.slice(0, 50),
        next_cursor: rows.length > 50 ? rows[49].id : null,
      };
    });
  }
  async sourceHistory(o: LightTickOwner, id: string, before = 2147483648) {
    identity(id, "source-");
    integer(before, 1, 2147483648);
    return this.repo.transaction(o, async () => {
      await this.source(o, id);
      const rows = await this.store.sourceHistory(o, id, before, 31);
      return {
        items: rows.slice(0, 30),
        next_cursor: rows.length > 30 ? String(rows[29].revision) : null,
      };
    });
  }
  async saveSource(o: LightTickOwner, id: string, raw: unknown, key: string) {
    identity(id, "source-");
    const b = structuredClone(object(raw));
    keys(b, [
      "base_revision",
      "title",
      "url",
      "format",
      "archived",
      "language",
      "topics",
      "domains",
      "catalog_id",
    ]);
    const base = integer(b.base_revision, 0, 2147483646),
      title = text(b.title, 200, true),
      url = readingURL(b.url);
    if (
      !["article", "rss", "atom"].includes(String(b.format)) ||
      typeof b.archived !== "boolean"
    )
      fail(422, "请明确来源格式与归档状态。");
    return this.command(o, id, "source:save", b, key, async () => {
      const old = await this.store.source(o, id),
        now = this.clock().toISOString();
      if (old?.deleted_at) fail(409, "此来源配置已删除，请使用新的来源编号。");
      const row: ReadingSource = {
        ...readingSourceFields(b, old, url),
        id,
        revision: base + 1,
        title,
        url,
        format: b.format as ReadingSource["format"],
        archived: b.archived as boolean,
        created_at: old?.created_at ?? now,
        updated_at: now,
      };
      await this.store.saveSource(o, row, base);
      return row;
    });
  }
  async deleteSource(o: LightTickOwner, id: string, raw: unknown, key: string) {
    identity(id, "source-");
    const b = structuredClone(object(raw));
    keys(b, ["base_revision"]);
    const base = integer(b.base_revision, 1, 2147483646);
    return this.command(o, id, "source:delete", b, key, async () => {
      const old = await this.store.source(o, id);
      if (!old) fail(404, "未找到本人的阅读来源。");
      if (old.deleted_at) fail(409, "此来源配置已删除。");
      const now = this.clock().toISOString(),
        row = {
          ...old,
          revision: base + 1,
          archived: true,
          deleted_at: now,
          updated_at: now,
        };
      await this.store.saveSource(o, row, base);
      return row;
    });
  }
  async read(o: LightTickOwner, id: string) {
    identity(id, "readwork-");
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const row = await this.store.get(o, id);
      if (!row) fail(404, "未找到本人的阅读任务。");
      return this.data(row);
    });
  }
  async importPreview(o: LightTickOwner, id: string, index: number) {
    identity(id, "readwork-");
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const row = await this.store.get(o, id);
      if (!row) fail(404, "未找到本人的阅读任务。");
      const entry = await readingWorkEntry(this, o, row, index);
      if (row.kind === "fetch_full") {
        const parent = await this.repo.independentReading.reference(o, row.input.article_id!);
        if (!parent || parent.archived || parent.content_version !== row.input.content_version) fail(409, "补取来源已变化，请保留结果核对。");
      }
      return readingImportScope(this.repo, o, articleContent(entry.content), row.kind === "fetch_full" ? row.input.article_id : undefined);
    });
  }
  async list(o: LightTickOwner, after = "") {
    if (after) identity(after, "readwork-");
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const rows = await this.store.list(o, after, 31);
      return {
        items: rows.slice(0, 30).map((r) => this.summary(r)),
        next_cursor: rows.length > 30 ? rows[29].id : null,
      };
    });
  }
  async create(o: LightTickOwner, raw: unknown, key: string) {
    const b = structuredClone(object(raw)),
      kind = b.kind as Exclude<ReadingWorkKind, "recommend">,
      id = "readwork-" + digest([o.appId, o.userId, key]).slice(0, 40);
    if (
      ![
        "collect_url",
        "collect_source",
        "fetch_full",
        "guide",
        "translation",
        "summary",
        "english",
      ].includes(kind)
    )
      fail(422, "请选择阅读采集或AI资料类型。");
    keys(
      b,
      kind === "collect_url"
        ? ["kind", "url", "title", "candidate"]
        : kind === "collect_source"
          ? ["kind", "source_id", "base_revision"]
          : kind === "fetch_full"
            ? ["kind", "article_id", "content_version"]
            : [
                "kind",
                "article_id",
                "content_version",
                "paragraph_id",
                "source_range",
                "guide_format",
              ],
    );
    const result = await this.command(
      o,
      id,
      "work:create",
      b,
      key,
      async () => {
        const now = this.clock().toISOString(),
          usage = await this.store.usage(
            o,
            now.slice(0, 10) + "T00:00:00.000Z",
            now,
          );
        if (
          usage.ai_daily >= 12 &&
          ![
            "collect_url",
            "collect_source",
            "fetch_full",
            "recommend",
          ].includes(kind)
        )
          fail(429, "Today's reading model budget is exhausted");
        if (usage.daily >= 20)
          fail(429, "Today's20 reading work quota is exhausted");
        if (usage.pending >= 2)
          fail(429, "Complete or cancel pending reading work first");
        let input: ReadingWork["input"];
        if (kind === "collect_url") {
          const selected = {
            url: readingURL(b.url),
            title: text(b.title, 500, true),
          };
          input = {
            ...selected,
            format: "article",
            ...(b.candidate === undefined
              ? {}
              : await candidateReadingInput(
                  this.repo,
                  o,
                  b.candidate,
                  selected,
                )),
          };
        } else if (kind === "collect_source") {
          const source = await this.source(o, identity(b.source_id, "source-"));
          if (
            source.revision !== integer(b.base_revision, 1, 2147483647) ||
            source.archived
          )
            fail(409, "来源已变化或已归档，请核对后采集。");
          input = {
            source_id: source.id,
            source_revision: source.revision,
            url: source.url,
            title: source.title,
            format: source.format,
            source_domains: source.domains ?? [
              new URL(source.url).hostname.toLowerCase().replace(/\.$/, ""),
            ],
            source_metadata: {
              title: source.title,
              source_url: source.url,
              language: source.language ?? "unknown",
              published_at: null,
              publisher: source.title,
              topics: source.topics ?? [],
            },
          };
        } else {
          const article = await new ReadingService(
            this.repo,
            this.authorize,
            this.clock,
          ).read(o, identity(b.article_id, "article-"));
          if (kind === "fetch_full") {
            if (
              article.archived ||
              article.content_version !== b.content_version
            )
              fail(409, "原文版本已变化或已归档，请核对后补取全文。");
            if (!article.content.source_url)
              fail(422, "此文章没有可补取的原文链接。");
            const { body: _, ...source_metadata } = article.content;
            input = {
              article_id: article.id,
              content_version: article.content_version,
              url: readingURL(article.content.source_url),
              title: article.content.title,
              format: "article",
              source_metadata,
              parent_root_id: article.provenance?.root_article_id ?? article.id,
            };
          } else {
            const check = structuredClone(article);
            writeReadingMaterial(
              check,
              {
                base_revision: article.revision,
                content_version: b.content_version,
                kind,
                paragraph_id: b.paragraph_id,
                ...(b.source_range === undefined
                  ? {}
                  : { source_range: b.source_range }),
                text: "",
              },
              false,
              now,
            );
            const selected = freezeReadingAI(
              article,
              kind,
              b.paragraph_id,
              b.source_range,
              b.guide_format,
            );
            input = {
              article_id: article.id,
              content_version: article.content_version,
              paragraph_id: b.paragraph_id as string | null,
              ...(b.source_range === undefined
                ? {}
                : { source_range: selected.snapshot.source_range }),
              text: selected.text,
              ai_context: selected.snapshot,
              model_selection: await captureModel(this.repo, o),
            };
          }
        }
        const row: ReadingWork = {
          ...o,
          id,
          revision: 1,
          kind,
          status: "queued",
          started_at: null,
          finished_at: null,
          model_usage: null,
          input,
          output: null,
          adopted: {},
          attempt: 0,
          fence: null,
          lease_until: null,
          error_code: null,
          created_at: now,
          updated_at: now,
        };
        await this.store.save(row, 0);
        return this.data(row);
      },
    );
    await this.dispatch(o, id);
    return result;
  }
  async dispatch(o: LightTickOwner, id: string) {
    const row = await this.store.get(o, id);
    if (!row || row.status !== "queued") return;
    try {
      await this.queue.add(
        READING_WORK_JOB,
        { app_id: o.appId, user_id: o.userId, work_id: id },
        {
          attempts: 3,
          jobId: "reading-" + digest([o.userId, id]).slice(0, 40),
          backoffMs: 2000,
        },
      );
    } catch {
      await this.repo.transaction(o, async () => {
        const latest = await this.store.get(o, id);
        if (latest?.status === "queued")
          await this.store.save(
            {
              ...latest,
              revision: latest.revision + 1,
              error_code: "QUEUE_UNAVAILABLE",
              updated_at: this.clock().toISOString(),
            },
            latest.revision,
          );
      });
    }
  }
  async cancel(o: LightTickOwner, id: string, raw: unknown, key: string) {
    identity(id, "readwork-");
    const b = structuredClone(object(raw));
    keys(b, ["base_revision"]);
    integer(b.base_revision, 1, 2147483646);
    return this.command(o, id, "work:cancel", b, key, async () => {
      const row = await this.store.get(o, id);
      if (!row) fail(404, "未找到本人的任务。");
      if (
        row.revision !== b.base_revision ||
        !["queued", "running"].includes(row.status)
      )
        fail(409, "任务已变化或终结，请核对原请求。");
      const next: ReadingWork = {
        ...row,
        status: "cancelled",
        revision: row.revision + 1,
        fence: null,
        lease_until: null,
        error_code: "CANCELLED",
        finished_at: this.clock().toISOString(),
        updated_at: this.clock().toISOString(),
      };
      await this.store.save(next, row.revision);
      return this.data(next);
    });
  }
  async adopt(o: LightTickOwner, id: string, raw: unknown, key: string) {
    identity(id, "readwork-");
    const b = structuredClone(object(raw));
    keys(b, [
      "base_revision",
      "output_digest",
      "index",
      "base_article_revision",
      "response_view",
      "import_decision",
    ]);
    if (b.response_view !== undefined && b.response_view !== "summary")
      fail(422, "Invalid reading response view");
    integer(b.base_revision, 1, 2147483646);
    return this.command(o, id, "work:adopt", b, key, async () => {
      return adoptReadingWork(this, o, id, b);
    });
  }
}
