import { assertReadingNotErased } from "./reading-erasure.service.ts";
import { assertReadingJSON } from "./reading-json-safe.ts";
import { writeReadingFeedback } from "./reading-feedback.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { ReadingArticle, ReadingProvenance } from "./reading.types.ts";
import { writeReadingMaterial } from "./reading-materials.ts";
import {
  articleContent,
  articleId,
  articleQuery,
  personalFields,
} from "./reading.validation.ts";
import {
  digest,
  fail,
  integer,
  keys,
  object,
  text,
} from "../learning/native-learning.validation.ts";
export class ReadingService {
  constructor(
    readonly repo: LightTickRepository,
    readonly authorize: () => Promise<void> = async () => {},
    readonly clock = () => new Date(),
  ) {}
  async list(
    o: LightTickOwner,
    query: Record<string, string | undefined> = {},
  ) {
    const q = articleQuery(query);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const rows = await this.repo.reading.list(o, {
        ...q,
        limit: q.limit + 1,
      });
      const items = rows.slice(0, q.limit);
      return {
        items,
        next_cursor: rows.length > q.limit ? items.at(-1)!.id : null,
      };
    });
  }
  async catalog(
    o: LightTickOwner,
    query: Record<string, string | undefined> = {},
  ) {
    const q = articleQuery(query);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const rows = await this.repo.reading.catalog(o, {
        ...q,
        limit: q.limit + 1,
      });
      const items = rows.slice(0, q.limit);
      return {
        items,
        next_cursor: rows.length > q.limit ? items.at(-1)!.id : null,
      };
    });
  }
  async read(o: LightTickOwner, id: string) {
    articleId(id);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const row = await this.repo.reading.get(o, id);
      if (!row) {
        if (await this.repo.readingErasure.tombstone(o, id))
          assertReadingNotErased({ erased: true });
        fail(404, "未找到本人的文章。");
      }
      return row;
    });
  }
  async history(o: LightTickOwner, id: string, before = 2147483648) {
    articleId(id);
    integer(before, 1, 2147483648);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      if (!(await this.repo.reading.get(o, id)))
        fail(404, "未找到本人的文章。");
      const rows = await this.repo.reading.history(o, id, before, 31);
      const items = rows.slice(0, 30);
      return {
        items,
        next_cursor: rows.length > 30 ? String(items.at(-1)!.revision) : null,
      };
    });
  }
  async editions(o: LightTickOwner, id: string, after = "") {
    articleId(id);
    if (after) articleId(after);
    return this.repo.transaction(o, async () => {
      const row = await this.read(o, id),
        root = row.provenance?.root_article_id ?? row.id,
        rows = await this.repo.reading.editions(o, root, after, 21);
      return {
        items: rows.slice(0, 20).map((r) => ({
          id: r.id,
          title: r.content.title,
          content_version: r.content_version,
          revision: r.revision,
          archived: r.archived,
          created_at: r.created_at,
          provenance: r.provenance ?? null,
        })),
        next_cursor: rows.length > 20 ? rows[19].id : null,
      };
    });
  }
  async receipt(o: LightTickOwner, key: string) {
    this.key(key);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const row = await this.repo.getOperation(o, key);
      if (!row || row.entityType !== "reading_article")
        fail(404, "未找到本人的阅读请求回执。");
      assertReadingNotErased(row.resultPayload);
      return structuredClone(row.resultPayload) as unknown as ReadingArticle;
    });
  }
  async export(o: LightTickOwner) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const first = await this.repo.readingBackups.entries(
        o,
        "articles",
        "",
        1001,
      );
      if (first.length > 1000) fail(413, "请使用完整分片阅读副本。");
      if (first.some((r) => (r.value as { deleted?: boolean })?.deleted))
        fail(413, "存在已删除身份，请使用完整分片阅读副本，旧导出不省略墓碑。");
      const items: ReadingArticle[] = [];
      const history: ReadingArticle[] = [];
      for (const archived of [false, true]) {
        let after = "";
        while (true) {
          const page = await this.repo.reading.list(o, {
            search: "",
            filter: archived ? "archived" : "all",
            after,
            limit: 50,
          });
          items.push(...page);
          if (items.length > 1000)
            fail(413, "阅读导出超过1000篇，需分批导出；未返回截断副本。");
          if (page.length < 50) break;
          after = page.at(-1)!.id;
        }
      }
      for (const row of items) {
        const versions = await this.repo.reading.history(
          o,
          row.id,
          2147483648,
          1001,
        );
        history.push(...versions);
        if (history.length > 1000)
          fail(413, "阅读历史超过1000条，需分批导出。");
      }
      const vocabulary = await this.repo.reading.listVocabulary(o);
      const vocabulary_reviews = [];
      for (const entry of vocabulary)
        vocabulary_reviews.push({
          id: entry.id,
          reviews: await this.repo.reading.listVocabularyReviews(o, entry.id),
        });
      const sources = await this.repo.readingWork.sources(o, "", 1001, true),
        workRows = await this.repo.readingWork.list(o, "", 1001);
      if (sources.length > 1000 || workRows.length > 1000)
        fail(413, "阅读来源或任务超过1000项，未返回截断副本。");
      const source_history = [];
      let sourceVersions = 0;
      for (const source of sources) {
        const versions = await this.repo.readingWork.sourceHistory(
          o,
          source.id,
          2147483648,
          1001,
        );
        sourceVersions += versions.length;
        if (sourceVersions > 1000)
          fail(413, "阅读来源历史超过1000项，需分批导出。");
        source_history.push({ id: source.id, versions });
      }
      const work = workRows.map(
        ({
          appId: _,
          userId: __,
          fence: ___,
          lease_until: ____,
          input,
          ...r
        }) => ({ ...r, input }),
      );
      const preferences =
          (await this.repo.readingWork.preferences.get(o)) ?? null,
        preferences_history = await this.repo.readingWork.preferences.history(
          o,
          2147483648,
          1001,
        );
      if (preferences_history.length > 1000)
        fail(413, "阅读偏好历史超过容量，请使用历史分页核对。");
      const work_assets = [];
      for (const row of workRows) {
        for (const meta of await this.repo.readingWork.assets.list(o, row.id)) {
          const asset = await this.repo.readingWork.assets.get(
            o,
            row.id,
            meta.id,
          );
          if (!asset) fail(409, "Reading export asset unavailable");
          work_assets.push(asset);
          if (Buffer.byteLength(JSON.stringify(work_assets)) > 8 * 1024 * 1024)
            fail(
              413,
              "Reading asset export exceeds8MiB; no truncated copy returned",
            );
        }
      }
      const schedule = await this.repo.readingWork.schedule.history(
        o,
        "9999-12-31",
        1001,
      );
      if (schedule.length > 1000)
        fail(413, "Reading daily history exceeds complete export capacity");
      const data = {
        schedule,
        work_assets,
        preferences,
        preferences_history,
        format_version: 1,
        scope: "lighttick_reading",
        articles: items,
        sources,
        source_history,
        work,
        vocabulary,
        vocabulary_reviews,
        history,
      };
      if (Buffer.byteLength(JSON.stringify(data)) > 8 * 1024 * 1024)
        fail(413, "阅读导出超过8MiB，需分批导出。");
      return {
        ...data,
        exported_at: this.clock().toISOString(),
        sha256: digest(data),
      };
    });
  }
  private key(key: string) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key))
      fail(422, "请保留有效原请求编号。");
  }
  async write(
    o: LightTickOwner,
    id: string,
    action: string,
    raw: unknown,
    key: string,
    materialOrigin: "manual" | "ai" = "manual",
    provenance?: ReadingProvenance,
  ) {
    articleId(id);
    this.key(key);
    if (
      ![
        "import",
        "personal",
        "feedback",
        "position",
        "archive",
        "restore",
        "draft",
        "adopt",
      ].includes(action)
    )
      fail(422, "阅读操作无效。");
    // Freeze before waiting for the owner lock: the receipt fingerprints the actual intent.
    const body = structuredClone(object(raw));
    assertReadingJSON(body);
    const base = integer(body.base_revision, 0, 2147483646);
    const hash = digest({
      id,
      action,
      body,
      ...(materialOrigin === "ai" ? { materialOrigin } : {}),
      ...(provenance ? { provenance } : {}),
    });
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const receipt = await this.repo.getOperation(o, key);
      if (receipt) {
        if (
          receipt.entityType !== "reading_article" ||
          receipt.entityId !== id ||
          receipt.payloadHash !== hash
        )
          fail(409, "原请求编号已用于不同操作。");
        assertReadingNotErased(receipt.resultPayload);
        return structuredClone(
          receipt.resultPayload,
        ) as unknown as ReadingArticle;
      }
      if (await this.repo.readingErasure.tombstone(o, id))
        assertReadingNotErased({ erased: true });
      const old = await this.repo.reading.get(o, id);
      if (
        (old?.revision ?? 0) !== base ||
        (!old && action !== "import") ||
        (old && action === "import")
      )
        fail(409, "文章已变化，请保留输入并核对版本。");
      const now = this.clock().toISOString();
      let row: ReadingArticle;
      if (action === "import") {
        keys(body, ["base_revision", "content"]);
        const content = articleContent(body.content);
        row = {
          id,
          revision: 1,
          content,
          content_version: digest(content),
          personal: {
            notes: "",
            feedback: "",
            bookmark: false,
            later: false,
            read: false,
            read_at: null,
            positions: {},
          },
          provenance: provenance ?? {
            kind: "manual_import",
            work_id: null,
            source_id: null,
            parent_article_id: null,
            root_article_id: id,
            fetched_at: null,
            raw_sha256: null,
          },
          archived: false,
          created_at: now,
          updated_at: now,
        };
      } else {
        row = structuredClone(old!);
        if (action === "personal" || action === "position") {
          if (row.archived) fail(409, "请先恢复文章，再修改私人阅读状态。");
          if (body.content_version !== row.content_version)
            fail(409, "原文版本已变化，请核对。");
          if (action === "personal") {
            keys(body, ["base_revision", "content_version", "personal"]);
            row.personal = personalFields(body.personal, row.personal, now);
          } else {
            keys(body, [
              "base_revision",
              "content_version",
              "device_id",
              "position",
            ]);
            const device = text(body.device_id, 80, true);
            if (
              !/^[a-zA-Z0-9_-]{8,80}$/.test(device) ||
              ["__proto__", "prototype", "constructor"].includes(device)
            )
              fail(422, "阅读设备标识无效。");
            if (
              !(device in row.personal.positions) &&
              Object.keys(row.personal.positions).length >= 100
            )
              fail(413, "阅读设备位置已达上限。");
            row.personal.positions[device] = integer(
              body.position,
              0,
              row.content.body.length,
            );
          }
        } else if (action === "feedback") {
          writeReadingFeedback(row, body, now);
        } else if (action === "draft" || action === "adopt") {
          writeReadingMaterial(
            row,
            body,
            action === "adopt",
            now,
            materialOrigin,
          );
        } else {
          keys(body, ["base_revision"]);
          if (row.archived === (action === "archive"))
            fail(409, "归档状态已变化，请刷新。");
          row.archived = action === "archive";
        }
        row.revision = base + 1;
        row.updated_at = now;
      }
      await this.repo.reading.save(o, row, base);
      await this.repo.saveOperation({
        ...o,
        operationId: key,
        deviceId: "reading-http",
        entityType: "reading_article",
        entityId: id,
        action,
        payloadHash: hash,
        requestPayload: body,
        resultPayload: row as unknown as Record<string, unknown>,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      return row;
    });
  }
}
