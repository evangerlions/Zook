import { ApplicationError } from "../../shared/errors.ts";
import { FeishuClient, FeishuApiError } from "./feishu-client.ts";
import type { ExpenseInput } from "./expense-input.ts";
import { FEISHU, FEISHU_FIELDS as F } from "./feishu-config.ts";

interface Field { field_id: string; field_name: string; type: number; property?: { options?: { name: string }[] }; }
interface RecordItem { record_id: string; fields: Record<string, unknown>; }
interface Page<T> { items?: T[]; has_more?: boolean; page_token?: string; }
interface Matrix { data: unknown[][]; field_id_list: string[]; fields: string[]; record_id_list: string[]; record_not_found?: string[]; has_more: boolean; }
function records(matrix: Matrix): RecordItem[] {
  if (!Array.isArray(matrix.data) || !Array.isArray(matrix.record_id_list) || !Array.isArray(matrix.fields)) throw new FeishuApiError(false);
  return matrix.data.map((cells, index) => ({ record_id: matrix.record_id_list[index], fields: Object.fromEntries(matrix.fields.map((name, column) => [name, cells[column]])) }))
    .filter(record => !matrix.record_not_found?.includes(record.record_id));
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(item => typeof item === "string" ? item : item?.text ?? "").join("");
  return "";
}

export class FeishuBookkeeping {
  constructor(private readonly client: FeishuClient) {}
  private path(table: string, suffix: string): string { return `bitable/v1/apps/${FEISHU.base}/tables/${table}/${suffix}`; }

  private recordPath(table: string, suffix: string): string { return `base/v3/bases/${FEISHU.base}/tables/${table}/${suffix}`; }

  async schema(): Promise<Field[]> {
    return this.allPages<Field>(this.path(FEISHU.expenses, "fields"));
  }

  async categories(): Promise<{ category: string; subcategory: string }[]> {
    const fields = await this.allPages<Field>(this.path(FEISHU.categories, "fields"));
    const major = fields.find(field => field.field_id === "fldQbmLf6H")?.field_name;
    const minor = fields.find(field => field.field_id === "fldRqyrIId")?.field_name;
    if (!major || !minor) throw new ApplicationError(502, "FEISHU_SCHEMA_CHANGED", "Category schema has changed.");
    const rows: RecordItem[] = [];
    for (let offset = 0; offset < 10000; offset += 100) {
      const result = await this.client.request<Matrix>(this.recordPath(FEISHU.categories, `records?limit=100&offset=${offset}&field_id=fldQbmLf6H&field_id=fldRqyrIId`));
      rows.push(...records(result));
      if (!result.has_more) return rows.map(item => ({ category: text(item.fields[major]), subcategory: text(item.fields[minor]) })).filter(item => item.category && item.subcategory);
    }
    throw new ApplicationError(502, "FEISHU_UNAVAILABLE", "Category pagination did not complete.");
  }

  async list(pageSize = 100, pageToken?: string): Promise<Page<RecordItem>> {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || pageToken && pageToken.length > 2048) {
      throw new ApplicationError(400, "REQ_INVALID_QUERY", "Invalid pagination.");
    }
    const offset = pageToken === undefined ? 0 : Number(pageToken);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000_000) throw new ApplicationError(400, "REQ_INVALID_QUERY", "Invalid page token.");
    const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    for (const field of Object.values(F)) query.append("field_id", field);
    const matrix = await this.client.request<Matrix>(this.recordPath(FEISHU.expenses, `records?${query}`));
    return { items: records(matrix), has_more: matrix.has_more, ...(matrix.has_more ? { page_token: String(offset + matrix.data.length) } : {}) };
  }

  async get(recordId: string): Promise<RecordItem> {
    if (!/^rec[A-Za-z0-9]{1,64}$/.test(recordId)) throw new ApplicationError(400, "REQ_INVALID_QUERY", "Invalid record ID.");
    const matrix = await this.client.request<Matrix>(this.recordPath(FEISHU.expenses, "records/batch_get"), { record_id_list: [recordId], field_id_list: Object.values(F) });
    const record = records(matrix)[0];
    if (!record) throw new ApplicationError(404, "REQ_INVALID_QUERY", "Expense record was not found.");
    record.fields = Object.fromEntries(Object.entries(record.fields).filter(([name]) => Object.values(F).includes(name as typeof F[keyof typeof F])));
    return record;
  }

  async prepare(input: ExpenseInput): Promise<Record<string, unknown>> {
    const schema = await this.schema();
    const categories = await this.categories();
    if (!categories.some(item => item.category === input.category && item.subcategory === input.subcategory)) {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Category pair is not present in the current category table.");
    }
    const fields: Record<string, unknown> = { [F.title]: input.title, [F.amount]: input.amount,
      [F.category]: input.category, [F.subcategory]: input.subcategory, [F.people]: [{ id: FEISHU.recipient }],
      [F.source]: input.source, ...(input.note === undefined ? {} : { [F.note]: input.note }),
      ...(input.occurredAt === undefined ? {} : { [F.date]: input.occurredAt }) };
    for (const [name, value] of Object.entries(fields)) {
      const field = schema.find(item => item.field_name === name);
      if (!field || field.type === 3 && !field.property?.options?.some(option => option.name === value)) {
        throw new ApplicationError(400, "FEISHU_SCHEMA_CHANGED", "Expense field or option has changed; inspect the current schema.");
      }
    }
    return fields;
  }

  async create(fields: Record<string, unknown>): Promise<{ recordId: string }> {
    // Base v3 has no upstream idempotency token. The durable Zook receipt owns retry safety.
    const native = { ...fields };
    for (const name of [F.category, F.subcategory, F.source]) native[name] = [native[name]];
    if (native[F.date] !== undefined) native[F.date] = new Date(native[F.date] as number).toISOString();
    const result = await this.client.request<{ record_id_list: string[] }>(this.recordPath(FEISHU.expenses, "records/batch_create"), { create_records: [native] });
    if (!result.record_id_list?.[0]) throw new FeishuApiError(false);
    return { recordId: result.record_id_list[0] };
  }

  private async allPages<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let token: string | undefined;
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ page_size: "100", ...(token ? { page_token: token } : {}) });
      const result = await this.client.request<Page<T>>(`${path}?${query}`);
      items.push(...result.items ?? []);
      if (!result.has_more) return items;
      if (!result.page_token || result.page_token === token) break;
      token = result.page_token;
    }
    throw new ApplicationError(502, "FEISHU_UNAVAILABLE", "Feishu pagination did not complete.");
  }
}
