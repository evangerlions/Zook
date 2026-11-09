import {
  object,
  keys,
  text,
  integer,
  fail,
} from "../learning/native-learning.validation.ts";
import type { FormRecords } from "./form-records.types.ts";
export const formKeys = [
  "modules",
  "checkins",
  "habits",
  "customFields",
  "customRecords",
  "decisions",
  "predictions",
  "reviews",
  "insights",
  "todos",
];
export function formDate(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "0001-01-01" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail(422, "日期无效。");
}
function identity(value: unknown) {
  const s = text(value, 128, true);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(s)) fail(422, "分类或字段编号无效。");
  return s;
}
function json(value: unknown, depth = 0): void {
  if (depth > 8) fail(422, "表单嵌套过深。");
  if (typeof value === "string") {
    if (value.length > 100000) fail(422, "单项文字过长。");
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    if (value.length > 5000) fail(422, "表单数组过长。");
    value.forEach((v) => json(v, depth + 1));
    return;
  }
  const o = object(value);
  if (Object.keys(o).length > 100) fail(422, "表单字段过多。");
  for (const [k, v] of Object.entries(o)) {
    if (k.length > 128 || ["__proto__", "constructor", "prototype"].includes(k))
      fail(422, "表单字段无效。");
    json(v, depth + 1);
  }
}
export function formRecords(value: unknown): FormRecords {
  const data = object(value);
  keys(data, formKeys);
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > 2 * 1024 * 1024)
    fail(422, "局部表单副本超过容量，请分片处理。");
  for (const k of formKeys) if (!(k in data)) fail(422, "局部副本缺少字段。");
  for (const k of [
    "modules",
    "customFields",
    "customRecords",
    "decisions",
    "predictions",
    "reviews",
    "insights",
    "todos",
  ]) {
    if (
      !Array.isArray(data[k]) ||
      data[k].length > (k === "modules" || k === "customFields" ? 100 : 5000)
    )
      fail(422, "表单条目超过容量。");
    for (const row of data[k]) {
      object(row);
      json(row);
    }
  }
  const modules = (data.modules as unknown[]).map((raw) => {
    const m = object(raw);
    keys(m, ["id", "name", "color", "order"]);
    const color = text(m.color, 7, true);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail(422, "分类颜色无效。");
    return {
      id: identity(m.id),
      name: text(m.name, 100, true),
      color,
      order: integer(m.order, 0, 10000),
    };
  });
  if (new Set(modules.map((m) => m.id)).size !== modules.length)
    fail(422, "分类编号重复。");
  const fields = (data.customFields as unknown[]).map((raw) => {
    const f = object(raw);
    keys(f, ["key", "label", "type"]);
    if (!["text", "number", "date"].includes(String(f.type)))
      fail(422, "字段类型无效。");
    return {
      key: identity(f.key),
      label: text(f.label, 100, true),
      type: f.type,
    };
  });
  if (new Set(fields.map((f) => f.key)).size !== fields.length)
    fail(422, "字段编号重复。");
  const checkins = object(data.checkins),
    habits = object(data.habits);
  if (
    Object.keys(checkins).length > 10000 ||
    Object.keys(habits).length > 10000
  )
    fail(422, "日期条目超过容量。");
  for (const [day, raw] of Object.entries(checkins)) {
    formDate(day);
    const row = object(raw);
    for (const [id, status] of Object.entries(row)) {
      if (!modules.some((m) => m.id === id))
        fail(422, "打卡引用了不存在的分类。");
      integer(status, 0, 3);
    }
  }
  for (const [day, raw] of Object.entries(habits)) {
    formDate(day);
    const row = object(raw);
    keys(row, ["minutes", "note"]);
    integer(row.minutes, 0, 1440);
    text(row.note, 100000);
  }
  return structuredClone({
    ...data,
    modules,
    customFields: fields,
  }) as unknown as FormRecords;
}
