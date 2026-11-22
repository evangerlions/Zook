import {
  experienceCursor,
  decodeExperienceCursor,
} from "./experience-cursor.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type {
  ApplicationData,
  ErrorData,
  ErrorTypeData,
  ExperienceKind,
  ExperienceObject,
  ExperienceQuery,
  Classification,
  ExperienceSection,
} from "./experience.types.ts";
import {
  experienceCategories,
  defaultErrorTypes,
} from "./experience-catalog.ts";
import {
  experienceData,
  experienceId,
  experienceQuery,
  safeExperienceText,
  experienceDate as validDate,
} from "./experience.validation.ts";
import {
  digest,
  integer,
  keys,
  object,
  fail,
} from "../learning/native-learning.validation.ts";
import { businessDay } from "../actions/action.validation.ts";
import { experienceStatistics } from "./experience-statistics.ts";
import { ApplicationError } from "../../../shared/errors.ts";
export const experiencePlural = (kind: ExperienceKind) =>
  kind === "application"
    ? "applications"
    : kind === "error"
      ? "errors"
      : "error-types";
export class ExperienceService {
  constructor(
    readonly repo: LightTickRepository,
    readonly authorize: () => Promise<void> = async () => {},
    readonly clock = () => new Date(),
  ) {}
  private run<T>(o: LightTickOwner, fn: () => Promise<T>) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      return fn();
    });
  }
  private gone(): never {
    throw new ApplicationError(
      410,
      "LIGHTTICK_RESOURCE_NOT_FOUND",
      "对象已永久删除；请保留本机副本，不要换编号重放原请求。",
    );
  }
  private async current(o: LightTickOwner, kind: ExperienceKind, id: string) {
    if (await this.repo.experience.tombstone(o, kind, id)) this.gone();
    const row =
      (await this.repo.experience.get(o, kind, id)) ??
      (kind === "error_type"
        ? defaultErrorTypes.find((t) => t.id === id)
        : undefined);
    return row ? structuredClone(row) : undefined;
  }
  async read(o: LightTickOwner, kind: ExperienceKind, id: string) {
    experienceId(kind, id);
    return this.run(o, async () => {
      const row = await this.current(o, kind, id);
      if (!row) fail(404, "未找到此账号的记录。");
      return row;
    });
  }
  async categories(
    o: LightTickOwner,
    raw: Record<string, string | undefined> = {},
  ) {
    keys(raw, ["after"]);
    const after =
      raw.after === undefined ? "" : safeExperienceText(raw.after, 128, true);
    if (after && !/^module-[a-zA-Z0-9_-]+$/.test(after))
      fail(422, "分类起点无效。");
    return this.run(o, async () => {
      const rows = await this.repo.learningModules.list(o, after, 51, "active"),
        items = rows.slice(0, 50).map((r) => ({
          id: r.id,
          title: r.title,
          revision: r.revision,
          basis: "learning-module" as const,
        }));
      return { items, next_after: rows.length > 50 ? items.at(-1)!.id : null };
    });
  }
  async setup(o: LightTickOwner) {
    return this.run(o, async () => ({
      categories: experienceCategories,
      catalog_version: "grow-experience-v1",
      personal_projects_preloaded: false,
    }));
  }
  async list(
    o: LightTickOwner,
    kind: ExperienceKind,
    raw: Record<string, string | undefined> = {},
  ) {
    const q = experienceQuery(kind, raw),
      scope = { operation: "list", ...q, limit: undefined };
    return this.run(o, async () => {
      const head = await this.repo.domainChanges.head(o, "experience");
      if (raw.cursor) {
        const p = object(decodeExperienceCursor(o, scope, head, raw.cursor));
        keys(p, ["id", "date"]);
        const id = experienceId(kind, p.id),
          date = p.date === null ? null : validDate(p.date);
        q.after = { id, date };
      }
      const rows = await this.repo.experience.page(o, {
          ...q,
          limit: q.limit + 1,
        }),
        items = rows.slice(0, q.limit),
        last = items.at(-1);
      return {
        items,
        next_cursor:
          rows.length > q.limit && last
            ? experienceCursor(o, scope, head, { id: last.id, date: last.date })
            : null,
        dataset_revision: head,
      };
    });
  }
  async history(
    o: LightTickOwner,
    kind: ExperienceKind,
    id: string,
    before = 2147483648,
  ) {
    experienceId(kind, id);
    integer(before, 1, 2147483648);
    return this.run(o, async () => {
      if (!(await this.current(o, kind, id))) fail(404, "记录不存在。");
      const rows = await this.repo.experience.history(o, kind, id, before, 51),
        items = rows.slice(0, 50),
        catalog =
          kind === "error_type"
            ? defaultErrorTypes.find((t) => t.id === id)
            : undefined;
      const catalogPending = rows.length <= 50 && !!catalog;
      if (catalogPending && items.length < 50)
        items.push(structuredClone(catalog!));
      return {
        items,
        next_cursor:
          rows.length > 50 ||
          (catalogPending && items.length === 50 && items.at(-1)!.revision > 0)
            ? String(items.at(-1)!.revision)
            : null,
      };
    });
  }
  async receipt(o: LightTickOwner, key: string) {
    this.key(key);
    return this.run(o, async () => {
      const op = await this.repo.getOperation(o, key);
      if (!op) return { found: false as const };
      if (op.entityType !== "experience")
        fail(404, "未找到此账号的经验记录原请求。");
      if (op.resultPayload.erased === true) this.gone();
      return {
        found: true as const,
        operation_id: key,
        payload_hash: op.payloadHash,
        fingerprint_version: "zook-experience-request-v1",
        action: op.action,
        result: structuredClone(op.resultPayload),
      };
    });
  }
  async export(
    o: LightTickOwner,
    raw: Record<string, string | undefined> = {},
  ) {
    keys(raw, ["section", "cursor", "limit", "revision"]);
    const section = raw.section ?? "objects";
    if (!["objects", "versions", "tombstones", "receipts"].includes(section))
      fail(422, "导出栏目无效。");
    const limit =
      raw.limit === undefined ? 50 : integer(Number(raw.limit), 1, 50);
    return this.run(o, async () => {
      const head = await this.repo.domainChanges.head(o, "experience");
      if (raw.revision !== undefined && raw.revision !== head)
        fail(409, "数据已变化，请重新完整导出；尚未生成截断副本。");
      const scope = {
          operation: "export",
          section,
          format: "lighttick-experience-v1",
        },
        after = raw.cursor
          ? safeExperienceText(
              decodeExperienceCursor(o, scope, head, raw.cursor),
              1024,
            )
          : "",
        rows = await this.repo.experience.entries(
          o,
          section as ExperienceSection,
          after,
          limit + 1,
        ),
        records = rows.slice(0, limit);
      if (Buffer.byteLength(JSON.stringify(records), "utf8") > 8 * 1024 * 1024)
        fail(413, "此页超过8MiB，请减小每页数量；未返回截断内容。");
      const body = {
        format: "lighttick-experience-v1",
        section,
        dataset_revision: head,
        catalog_version: "grow-experience-v1",
        records,
      };
      return {
        ...body,
        page_sha256: digest(body),
        next_cursor:
          rows.length > limit
            ? experienceCursor(o, scope, head, records.at(-1)!.key)
            : null,
      };
    });
  }
  private key(key: string) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key))
      fail(422, "请保留有效原请求编号。");
  }
  private async classification(
    o: LightTickOwner,
    id: string | null,
    previous: ExperienceObject | undefined,
    refresh: boolean,
  ): Promise<Classification | null> {
    if (id === null) return null;
    if (
      !refresh &&
      previous &&
      previous.kind !== "error_type" &&
      (previous.data as ApplicationData).module_id === id
    )
      return previous.classification;
    const fixed = experienceCategories.find((c) => c.id === id);
    if (fixed) return { ...fixed };
    const module = await this.repo.learningModules.get(o, id);
    if (!module || module.archived)
      fail(409, "分类已不可用，请保留输入重新选择。");
    return {
      id,
      title: module.title,
      revision: module.revision,
      basis: "learning-module",
    };
  }
  private async validateError(
    o: LightTickOwner,
    id: string,
    data: ErrorData,
    previous: ExperienceObject | undefined,
  ) {
    const old =
      previous?.kind === "error" ? (previous.data as ErrorData) : undefined;
    let typeRevision: number | null = null;
    if (data.type_id) {
      if (old?.type_id === data.type_id && old.error_type === data.error_type)
        typeRevision = previous!.type_revision;
      else {
        const t = await this.current(o, "error_type", data.type_id);
        if (
          !t ||
          t.archived ||
          (t.data as ErrorTypeData).name !== data.error_type
        )
          fail(409, "错误类型已变化，请保留输入核对名称与历史。");
        typeRevision = t.revision;
      }
    }
    if (data.related_error_id) {
      let next: string | null = data.related_error_id;
      const seen = new Set([id]);
      for (let n = 0; next; n++) {
        if (n >= 1000) fail(413, "关联链超过1000项，未写入任何记录。");
        if (seen.has(next)) fail(422, "错误关联不能指向自己或形成循环。");
        seen.add(next);
        const related = await this.repo.experience.get(o, "error", next);
        if (!related || related.archived) {
          if (next !== data.related_error_id || old?.related_error_id === next)
            break;
          fail(409, "关联错误不可用，请保留输入重新核对。");
        }
        next = (related.data as ErrorData).related_error_id;
      }
    }
    return typeRevision;
  }
  async write(
    o: LightTickOwner,
    kind: ExperienceKind,
    id: string,
    action: "save" | "archive" | "restore" | "delete",
    raw: unknown,
    key: string,
  ) {
    experienceId(kind, id);
    this.key(key);
    const body = structuredClone(object(raw));
    keys(
      body,
      action === "save"
        ? [
            "base_revision",
            "data",
            ...(kind !== "error_type"
              ? ["refresh_classification", "classification_revision"]
              : []),
            ...(kind === "error" ? ["type_revision"] : []),
          ]
        : action === "delete"
          ? ["base_revision", "scope_digest"]
          : ["base_revision"],
    );
    const base = integer(body.base_revision, 0, 2147483646);
    if (action === "save" && kind !== "error_type") {
      if (body.classification_revision !== null)
        integer(body.classification_revision, 1, 2147483647);
      if (kind === "error" && body.type_revision !== null)
        integer(body.type_revision, 0, 2147483647);
    }
    const path =
        "experience/" +
        experiencePlural(kind) +
        "/" +
        id +
        (action === "save" ? "" : "/" + action),
      hash = digest({ method: action === "save" ? "PUT" : "POST", path, body });
    return this.run(o, async () => {
      const op = await this.repo.getOperation(o, key);
      if (op) {
        if (
          op.entityType !== "experience" ||
          op.entityId !== id ||
          op.action !== action ||
          op.payloadHash !== hash
        )
          fail(409, "原请求编号已用于另一操作。");
        if (op.resultPayload.erased === true) this.gone();
        return structuredClone(op.resultPayload) as unknown as
          | ExperienceObject
          | {
              id: string;
              kind: ExperienceKind;
              revision: number;
              deleted: true;
              deleted_at: string;
            };
      }
      const old = await this.current(o, kind, id);
      if ((old?.revision ?? 0) !== base)
        fail(409, "记录已变化，请保留输入核对云端版本。");
      if (!old && action !== "save") fail(404, "记录不存在。");
      const now = this.clock().toISOString();
      let result:
        | ExperienceObject
        | {
            id: string;
            kind: ExperienceKind;
            revision: number;
            deleted: true;
            deleted_at: string;
          };
      if (action === "delete") {
        const preview = await this.scope(o, kind, id, old!);
        if (preview.scope_digest !== body.scope_digest)
          fail(409, "删除范围已变化，未删除任何内容。");
        if (kind === "error_type" && preview.references > 0)
          fail(409, "此类型仍被错误记录引用，请先归档或明确修改关联。");
        result = {
          id,
          kind,
          revision: base + 1,
          deleted: true,
          deleted_at: now,
        };
        await this.repo.experience.erase(o, result);
      } else {
        if (
          body.refresh_classification !== undefined &&
          typeof body.refresh_classification !== "boolean"
        )
          fail(422, "请明确是否更新分类名称。");
        const data =
          action === "save" ? experienceData(kind, body.data) : old!.data;
        if (action === "save" && old?.archived)
          fail(409, "请先恢复记录，再保存修改。");
        if (
          kind === "error_type" &&
          action !== "archive" &&
          (await this.repo.experience.typeNameUsed(
            o,
            (data as ErrorTypeData).name,
            id,
          ))
        )
          fail(409, "此账号已有同名活跃类型。");
        const classification =
          kind === "error_type"
            ? null
            : action === "save"
              ? await this.classification(
                  o,
                  (data as ApplicationData).module_id,
                  old,
                  body.refresh_classification === true,
                )
              : old!.classification;
        const type_revision =
          kind === "error" && action === "save"
            ? await this.validateError(o, id, data as ErrorData, old)
            : (old?.type_revision ?? null);
        if (action === "save" && kind !== "error_type") {
          if (
            body.classification_revision !== (classification?.revision ?? null)
          )
            fail(409, "分类修订与本次选择不符，请核对当前名称或保留历史快照。");
          if (kind === "error" && body.type_revision !== type_revision)
            fail(409, "错误类型修订已变化，请保留输入核对。");
        }
        result = {
          id,
          kind,
          revision: base + 1,
          data,
          classification,
          type_revision,
          archived:
            action === "archive"
              ? true
              : action === "restore"
                ? false
                : (old?.archived ?? false),
          created_at: old ? old.created_at : now,
          updated_at: now,
        };
        await this.repo.experience.save(o, result, base);
      }
      await this.repo.saveOperation({
        ...o,
        operationId: key,
        deviceId: "experience-http",
        entityType: "experience",
        entityId: id,
        action,
        payloadHash: hash,
        requestPayload: body,
        resultPayload: result as unknown as Record<string, unknown>,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      return result;
    });
  }
  private async scope(
    o: LightTickOwner,
    kind: ExperienceKind,
    id: string,
    row: ExperienceObject,
  ) {
    const counts = await this.repo.experience.scope(o, kind, id);
    if (counts.versions > 10000 || counts.receipts.length > 10000)
      fail(413, "历史或回执超过10000项，尚未删除任何内容。");
    const facts = { id, kind, revision: row.revision, ...counts };
    return { ...facts, scope_digest: digest(facts) };
  }
  async deletionPreview(o: LightTickOwner, kind: ExperienceKind, id: string) {
    experienceId(kind, id);
    return this.run(o, async () => {
      const row = await this.current(o, kind, id);
      if (!row) fail(404, "记录不存在。");
      return this.scope(o, kind, id, row);
    });
  }
  async stats(
    o: LightTickOwner,
    kind: "application" | "error",
    raw: Record<string, string | undefined> = {},
  ) {
    const { period, end, ...filters } = raw,
      days = period === undefined ? 30 : integer(Number(period), 1, 365),
      last =
        end === undefined
          ? businessDay(this.clock(), "Asia/Shanghai")
          : validDate(end),
      start = new Date(Date.parse(last + "T00:00:00Z") - (days - 1) * 86400000)
        .toISOString()
        .slice(0, 10),
      q = experienceQuery(kind, filters);
    if (start < "0001-01-01" || !/^\d{4}-\d\d-\d\d$/.test(start))
      fail(422, "统计周期超出公历范围，请缩小日期范围。");
    if (
      filters.cursor !== undefined ||
      filters.limit !== undefined ||
      filters.date_from !== undefined ||
      filters.date_to !== undefined
    )
      fail(422, "统计使用结束日期和周期，请勿混入列表游标或日期范围。");
    return this.run(o, async () => {
      const rows = await this.repo.experience.aggregate(o, q, start, last);
      if (rows.length > 10000)
        fail(413, "统计分组超过10000项，请缩小范围；未返回截断统计。");
      return { kind, ...experienceStatistics(rows, start, last) };
    });
  }
  async repeated(
    o: LightTickOwner,
    raw: Record<string, string | undefined> = {},
  ) {
    const q = experienceQuery("error", raw),
      scope = { operation: "repeated", ...q, limit: undefined };
    return this.run(o, async () => {
      const head = await this.repo.domainChanges.head(o, "experience");
      if (raw.cursor) {
        const p = object(decodeExperienceCursor(o, scope, head, raw.cursor));
        keys(p, ["type", "count"]);
        q.after = {
          id: safeExperienceText(p.type, 50, true),
          date: null,
          count: integer(p.count, 2, 2147483647),
        };
      }
      const rows = await this.repo.experience.repeated(o, {
          ...q,
          limit: q.limit + 1,
        }),
        items = rows.slice(0, q.limit),
        last = items.at(-1);
      return {
        items,
        next_cursor:
          rows.length > q.limit && last
            ? experienceCursor(o, scope, head, {
                type: last.error_type,
                count: last.count,
              })
            : null,
        dataset_revision: head,
        basis: "same-exact-type-name-at-least-two",
        self_reported_repeat_is_separate: true,
      };
    });
  }
  async concepts(
    o: LightTickOwner,
    raw: Record<string, string | undefined> = {},
  ) {
    keys(raw, ["cursor", "limit"]);
    const limit =
      raw.limit === undefined ? 50 : integer(Number(raw.limit), 1, 50);
    return this.run(o, async () => {
      const head = await this.repo.domainChanges.head(o, "experience"),
        scope = { operation: "concepts" },
        after = raw.cursor
          ? safeExperienceText(
              decodeExperienceCursor(o, scope, head, raw.cursor),
              100,
            )
          : "",
        rows = await this.repo.experience.concepts(o, after, limit + 1),
        items = rows.slice(0, limit);
      return {
        items,
        next_cursor:
          rows.length > limit
            ? experienceCursor(o, scope, head, items.at(-1))
            : null,
        dataset_revision: head,
      };
    });
  }
}
