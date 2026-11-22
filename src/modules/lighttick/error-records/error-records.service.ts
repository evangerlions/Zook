import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import {
  digest,
  integer,
  text,
  keys,
} from "../learning/native-learning.validation.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import {
  DEFAULT_ERROR_CATEGORIES,
  type ErrorRecord,
  type ErrorCategory,
} from "./error-records.types.ts";
import {
  invalid,
  calendarDate,
  errorId,
  errorQuery,
} from "./error-records.validation.ts";
const conflict = (m = "记录或分类已在其他页面更新，请刷新核对。") =>
    new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", m),
  missing = () =>
    new ApplicationError(
      404,
      "LIGHTTICK_RESOURCE_NOT_FOUND",
      "错误记录或分类不存在。",
    );
export class ErrorRecordsService {
  constructor(
    readonly repo: LightTickRepository,
    readonly clock: () => Date = () => new Date(),
  ) {}
  private key(k: string) {
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(k)) throw invalid("请求编号无效。");
    return k;
  }
  private async write<T>(
    o: LightTickOwner,
    id: string,
    action: string,
    b: Record<string, unknown>,
    key: string,
    run: () => Promise<T>,
    authorize: () => Promise<void> = async () => {},
  ) {
    this.key(key);
    return this.repo.transaction(o, async () => {
      await authorize();
      const hash = digest({ id, action, b }),
        old = await this.repo.getOperation(o, "error-record:" + key);
      if (old) {
        if (old.payloadHash !== hash)
          throw conflict("同一请求编号不能用于不同错误记录操作。");
        return old.resultPayload as T;
      }
      const result = await run(),
        now = this.clock().toISOString();
      await this.repo.saveOperation({
        ...o,
        operationId: "error-record:" + key,
        deviceId: "error-records",
        entityType: "error-record",
        entityId: id,
        action,
        requestPayload: b,
        payloadHash: hash,
        resultPayload: result as Record<string, unknown>,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      return result;
    });
  }
  async receipt(o: LightTickOwner, key: string) {
    this.key(key);
    const r = await this.repo.getOperation(o, "error-record:" + key);
    if (!r) throw missing();
    return r.resultPayload;
  }
  private async categories(o: LightTickOwner) {
    const custom = await this.repo.errorRecords.categories(o);
    if (custom.length > 100) throw invalid("自定义错误分类超过 100 个。");
    return [...DEFAULT_ERROR_CATEGORIES, ...custom];
  }
  async catalog(o: LightTickOwner) {
    return this.repo.transaction(o, async () => {
      const categories = await this.categories(o),
        owned = await this.repo.listLearningModules(o),
        templates = await this.repo.listLearningModuleTemplates(),
        modules = [
          { id: "general", title: "通用 / 工作生活" },
          ...new Map(
            [...templates, ...owned]
              .filter((m) => m.id !== "general")
              .map((m) => [m.id, { id: m.id, title: m.title }]),
          ).values(),
        ],
        timezone = (await this.repo.getProfile(o))?.timezone ?? "UTC";
      return {
        categories,
        modules,
        business_date: businessDateAt(this.clock(), timezone),
        timezone,
      };
    });
  }
  async list(o: LightTickOwner, q: Record<string, string | undefined>) {
    return this.repo.transaction(o, async () =>
      this.repo.errorRecords.list(
        o,
        errorQuery(
          q,
          this.clock(),
          (await this.repo.getProfile(o))?.timezone ?? "UTC",
        ),
      ),
    );
  }
  async lookup(o: LightTickOwner, q: Record<string, string | undefined>) {
    const query = (q.q ?? "").trim(),
      page = q.page ?? "1";
    if (
      query.length > 200 ||
      query.includes("\0") ||
      !/^[1-9]\d*$/.test(page) ||
      Number(page) > 1000000
    )
      throw invalid("历史关联搜索条件无效。");
    return this.repo.transaction(o, () =>
      this.repo.errorRecords.lookup(o, query, Number(page)),
    );
  }
  async detail(o: LightTickOwner, id: string, after = "") {
    errorId(id);
    if (after) errorId(after);
    return this.repo.transaction(o, async () => {
      const record = await this.repo.errorRecords.get(o, id);
      if (!record) throw missing();
      const related = record.related_error_id
        ? await this.repo.errorRecords.get(o, record.related_error_id)
        : undefined;
      return {
        record,
        related: related ?? null,
        linked_from: await this.repo.errorRecords.linked(o, id, after, 10),
      };
    });
  }
  async save(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
    authorize?: () => Promise<void>,
  ) {
    errorId(id);
    keys(b, [
      "base_version",
      "date",
      "module_id",
      "category_id",
      "description",
      "severity",
      "context",
      "improvement_action",
      "is_repeat",
      "related_error_id",
    ]);
    const base = integer(b.base_version, 0, 2147483646),
      date = calendarDate(b.date),
      module_id = text(b.module_id, 100, true),
      category_id = text(b.category_id, 100, true);
    if (
      typeof b.is_repeat !== "boolean" ||
      (b.related_error_id !== null && typeof b.related_error_id !== "string")
    )
      throw invalid("重复标记或关联错误无效。");
    const related =
      b.related_error_id === null ? null : errorId(b.related_error_id);
    const data = {
      date,
      module_id,
      category_id,
      description: text(b.description, 500, true),
      severity: integer(b.severity, 0, 5),
      context: text(b.context, 500),
      improvement_action: text(b.improvement_action, 500),
      is_repeat: b.is_repeat,
      related_error_id: related,
    };
    return this.write(
      o,
      id,
      "save",
      b,
      key,
      async () => {
        const old = await this.repo.errorRecords.get(o, id);
        if ((old?.version ?? 0) !== base || old?.archived) throw conflict();
        const catalog = await this.catalog(o);
        if (!catalog.categories.some((t) => t.id === category_id))
          throw invalid("请选择可用错误分类。");
        if (
          !catalog.modules.some((m) => m.id === module_id) &&
          module_id !== old?.module_id
        )
          throw invalid("请选择本人可用模块或通用。");
        if (related) {
          let cursor: string | null = related;
          const seen = new Set([id]);
          for (let depth = 0; cursor; depth++) {
            if (depth >= 64)
              throw invalid("关联链超过 64 条，请选择更近的参考记录。");
            if (seen.has(cursor)) throw invalid("不能关联自己或形成循环关联。");
            seen.add(cursor);
            const target = await this.repo.errorRecords.get(o, cursor);
            if (
              !target ||
              (depth === 0 &&
                target.archived &&
                related !== old?.related_error_id)
            )
              throw invalid("关联错误不可用，请选择本人未归档记录。");
            cursor = target.related_error_id;
          }
        }
        const now = this.clock().toISOString(),
          row: ErrorRecord = {
            id,
            version: base + 1,
            ...data,
            archived: false,
            created_at: old?.created_at ?? now,
            updated_at: now,
          };
        await this.repo.errorRecords.save(o, row, base);
        return row;
      },
      authorize,
    );
  }
  archive(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
    authorize?: () => Promise<void>,
  ) {
    errorId(id);
    keys(b, ["base_version", "archived"]);
    const base = integer(b.base_version, 1, 2147483646);
    if (typeof b.archived !== "boolean") throw invalid("请确认归档或恢复。");
    return this.write(
      o,
      id,
      "archive",
      b,
      key,
      async () => {
        const old = await this.repo.errorRecords.get(o, id);
        if (!old) throw missing();
        if (old.version !== base) throw conflict();
        const row = {
          ...old,
          version: base + 1,
          archived: b.archived as boolean,
          updated_at: this.clock().toISOString(),
        };
        await this.repo.errorRecords.save(o, row, base);
        return row;
      },
      authorize,
    );
  }
  createCategory(
    o: LightTickOwner,
    b: Record<string, unknown>,
    key: string,
    authorize?: () => Promise<void>,
  ) {
    keys(b, ["name", "description"]);
    const id = "etype-" + digest([o.appId, o.userId, key]).slice(0, 32);
    return this.category(o, id, { ...b, base_version: 0 }, key, authorize);
  }
  category(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
    authorize?: () => Promise<void>,
  ) {
    if (!/^etype-[a-f0-9]{32}$/.test(id)) throw invalid("预设分类不可修改。");
    keys(b, ["base_version", "name", "description"]);
    const base = integer(b.base_version, 0, 2147483646),
      name = text(b.name, 50, true).trim(),
      description = text(b.description, 200).trim();
    return this.write(
      o,
      id,
      "category",
      b,
      key,
      async () => {
        const all = await this.categories(o),
          old = all.find((t) => t.id === id);
        if ((old?.version ?? 0) !== base) throw conflict();
        if (
          all.some(
            (t) =>
              t.id !== id &&
              t.name.normalize("NFKC").toLowerCase() ===
                name.normalize("NFKC").toLowerCase(),
          )
        )
          throw conflict("该错误分类名称已存在。");
        if (!old && all.filter((t) => !t.builtin).length >= 100)
          throw invalid("自定义分类最多 100 个。");
        const row: ErrorCategory = {
          id,
          version: base + 1,
          name,
          description,
          builtin: false,
        };
        await this.repo.errorRecords.saveCategory(o, row, base);
        return row;
      },
      authorize,
    );
  }
  deleteCategory(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
    authorize?: () => Promise<void>,
  ) {
    if (!/^etype-[a-f0-9]{32}$/.test(id)) throw invalid("预设分类不可删除。");
    keys(b, ["base_version"]);
    const base = integer(b.base_version, 1, 2147483646);
    return this.write(
      o,
      id,
      "delete-category",
      b,
      key,
      async () => {
        if (await this.repo.errorRecords.categoryUsage(o, id))
          throw conflict("分类仍被错误记录引用，包括归档记录。");
        await this.repo.errorRecords.deleteCategory(o, id, base);
        return { id, version: base, deleted: true };
      },
      authorize,
    );
  }
}
