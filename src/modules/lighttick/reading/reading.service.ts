import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { ReadingArticle } from "./reading.types.ts";
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
  async read(o: LightTickOwner, id: string) {
    articleId(id);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const row = await this.repo.reading.get(o, id);
      if (!row) fail(404, "未找到本人的文章。");
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
  async receipt(o: LightTickOwner, key: string) {
    this.key(key);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const row = await this.repo.getOperation(o, key);
      if (!row || row.entityType !== "reading_article")
        fail(404, "未找到本人的阅读请求回执。");
      return structuredClone(row.resultPayload) as unknown as ReadingArticle;
    });
  }
  async export(o: LightTickOwner) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
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
      const data = {
        format_version: 1,
        scope: "lighttick_reading",
        articles: items,
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
  ) {
    articleId(id);
    this.key(key);
    if (
      !["import", "personal", "position", "archive", "restore"].includes(action)
    )
      fail(422, "阅读操作无效。");
    // Freeze before waiting for the owner lock: the receipt fingerprints the actual intent.
    const body = structuredClone(object(raw));
    const base = integer(body.base_revision, 0, 2147483646);
    const hash = digest({ id, action, body });
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
        return structuredClone(
          receipt.resultPayload,
        ) as unknown as ReadingArticle;
      }
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
