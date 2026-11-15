import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { BehaviorRow, BehaviorQuery } from "./behavior.types.ts";
import {
  date as validDate,
  text,
  integer,
  keys,
  digest,
} from "../actions/action.validation.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { ApplicationError } from "../../../shared/errors.ts";
const fail = (status: number, message: string) =>
  new ApplicationError(
    status,
    status === 404
      ? "LIGHTTICK_RESOURCE_NOT_FOUND"
      : status === 409
        ? "LIGHTTICK_VERSION_CONFLICT"
        : "VALIDATION_ERROR",
    message,
  );
const date = (value: unknown) => {
  const d = validDate(value);
  if (d.startsWith("0000-")) throw fail(422, "日期年份须大于零。");
  return d;
};
export const behaviorId = (id: string) => {
  if (!/^application-[a-zA-Z0-9-]{1,100}$/.test(id))
    throw fail(422, "应用记录编号无效。");
  return id;
};
export class BehaviorService {
  constructor(
    readonly repo: LightTickRepository,
    readonly clock = () => new Date(),
    readonly authorize: () => Promise<void> = async () => {},
  ) {}
  async catalog(o: LightTickOwner) {
    return this.repo.transaction(o, async () => {
      const timezone = (await this.repo.getProfile(o))?.timezone ?? "UTC",
        modules = [
          { id: "general", title: "通用 / 工作生活" },
          ...new Map(
            [
              ...(await this.repo.listLearningModuleTemplates()),
              ...(await this.repo.listLearningModules(o)),
            ]
              .filter((m) => m.id !== "general")
              .map((m) => [m.id, { id: m.id, title: m.title }]),
          ).values(),
        ];
      return {
        modules,
        timezone,
        business_date: businessDateAt(this.clock(), timezone),
      };
    });
  }
  async get(o: LightTickOwner, id: string) {
    behaviorId(id);
    const r = await this.repo.behavior.get(o, id);
    if (!r) throw fail(404, "应用记录不存在。");
    return r;
  }
  async receipt(o: LightTickOwner, key: string) {
    this.key(key);
    const r = await this.repo.getOperation(o, "behavior:" + key);
    if (!r) throw fail(404, "原请求不存在。");
    return r.resultPayload as unknown as BehaviorRow;
  }
  key(key: string) {
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(key))
      throw fail(422, "原请求编号无效。");
  }
  private write(
    o: LightTickOwner,
    id: string,
    action: string,
    b: Record<string, unknown>,
    key: string,
    run: () => Promise<BehaviorRow>,
  ) {
    this.key(key);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const hash = digest({ id, action, b }),
        old = await this.repo.getOperation(o, "behavior:" + key);
      if (old) {
        if (old.payloadHash !== hash)
          throw fail(409, "原请求编号已用于其他操作。");
        return old.resultPayload as unknown as BehaviorRow;
      }
      const row = await run(),
        now = this.clock().toISOString();
      await this.repo.saveOperation({
        ...o,
        operationId: "behavior:" + key,
        deviceId: "behavior",
        entityType: "behavior",
        entityId: id,
        action,
        requestPayload: b,
        payloadHash: hash,
        resultPayload: row as unknown as Record<string, unknown>,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      return row;
    });
  }
  async save(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    b = structuredClone(b);
    behaviorId(id);
    keys(b, [
      "base_version",
      "date",
      "module_id",
      "concept",
      "scenario",
      "effectiveness",
    ]);
    const base = integer(b.base_version, 0, 2147483646),
      data = {
        date: date(b.date),
        module_id: text(b.module_id, 100, true),
        concept: text(b.concept, 100, true).trim(),
        scenario: text(b.scenario, 500).trim(),
        effectiveness: integer(b.effectiveness, 0, 5),
      };
    if (
      [data.concept, data.scenario, data.module_id].some((v) =>
        v.includes("\0"),
      )
    )
      throw fail(422, "文本包含无效字符。");
    return this.write(o, id, "save", b, key, async () => {
      const old = await this.repo.behavior.get(o, id);
      if ((old?.version ?? 0) !== base || old?.archived)
        throw fail(409, "应用记录已变化，请核对新版本。");
      if (
        !(await this.catalog(o)).modules.some((m) => m.id === data.module_id) &&
        old?.module_id !== data.module_id
      )
        throw fail(422, "所属模块不可用。");
      const now = this.clock().toISOString(),
        row = {
          id,
          version: base + 1,
          ...data,
          archived: false,
          created_at: old?.created_at ?? now,
          updated_at: now,
        };
      await this.repo.behavior.save(o, row, base);
      return row;
    });
  }
  async archive(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    b = structuredClone(b);
    behaviorId(id);
    keys(b, ["base_version", "archived"]);
    const base = integer(b.base_version, 1, 2147483646);
    if (typeof b.archived !== "boolean") throw fail(422, "请明确归档或恢复。");
    return this.write(o, id, "archive", b, key, async () => {
      const old = await this.get(o, id);
      if (old.version !== base) throw fail(409, "记录已变化。");
      const row = {
        ...old,
        archived: b.archived as boolean,
        version: base + 1,
        updated_at: this.clock().toISOString(),
      };
      await this.repo.behavior.save(o, row, base);
      return row;
    });
  }
  async list(o: LightTickOwner, q: Record<string, string | undefined>) {
    return this.repo.transaction(o, async () => {
      const c = await this.catalog(o),
        date_to = date(q.date_to ?? c.business_date),
        date_from = date(
          q.date_from ??
            new Date(Date.parse(date_to) - 29 * 86400000)
              .toISOString()
              .slice(0, 10),
        );
      if (
        date_from > date_to ||
        (Date.parse(date_to) - Date.parse(date_from)) / 86400000 > 365
      )
        throw fail(422, "回看范围须为1–366天。");
      const query: BehaviorQuery = {
        date_from,
        date_to,
        module_id: text(q.module_id ?? "", 100),
        concept: text(q.concept ?? "", 100),
        q: text(q.q ?? "", 200).trim(),
        archived: q.archived === "true",
        page: this.page(q.page),
      };
      if (
        !["true", "false"].includes(q.archived ?? "false") ||
        [query.q, query.module_id, query.concept].some((v) => v.includes("\0"))
      )
        throw fail(422, "筛选条件无效。");
      return { ...(await this.repo.behavior.list(o, query)), filters: query };
    });
  }
  page(v: string | undefined) {
    if (v !== undefined && (!/^[1-9]\d*$/.test(v) || Number(v) > 1000000))
      throw fail(422, "分页无效。");
    return Number(v ?? 1);
  }
  async concepts(o: LightTickOwner, q: Record<string, string | undefined>) {
    const query = text(q.q ?? "", 200).trim();
    if (query.includes("\0")) throw fail(422, "概念查询无效。");
    return this.repo.transaction(o, () =>
      this.repo.behavior.concepts(o, query, this.page(q.page)),
    );
  }
}
