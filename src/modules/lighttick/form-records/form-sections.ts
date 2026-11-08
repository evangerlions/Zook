import type { FormRecords } from "./form-records.types.ts";
import { formRecords, formDate } from "./form-records.validation.ts";
import {
  object,
  keys,
  text,
  fail,
} from "../learning/native-learning.validation.ts";
export const formSections = [
  "habits",
  "custom",
  "decisions",
  "predictions",
  "reviews",
  "insights",
  "todos",
] as const;
export type FormSection = (typeof formSections)[number];
export function formSection(value: string): FormSection {
  if (!formSections.includes(value as FormSection))
    fail(422, "不支持此表单栏目。");
  return value as FormSection;
}
const textFields: Record<string, string[]> = {
  decisions: [
    "title",
    "context",
    "options",
    "reason",
    "expected",
    "emotion",
    "actual",
    "bias",
  ],
  predictions: ["statement", "result", "deviation"],
  reviews: ["thought", "actual", "gap", "action"],
  insights: ["source", "insight"],
  todos: ["title"],
};
export function patchFormSection(
  current: FormRecords,
  section: FormSection,
  value: unknown,
): FormRecords {
  const input = structuredClone(current);
  if (section === "custom") {
    const custom = object(value);
    keys(custom, ["customFields", "customRecords"]);
    input.customFields = custom.customFields as FormRecords["customFields"];
    input.customRecords = custom.customRecords as FormRecords["customRecords"];
  } else (input as unknown as Record<string, unknown>)[section] = value;
  // The full resulting scope is checked under the owner transaction. Untouched historical fields remain verbatim.
  const next = formRecords(input);
  if (section === "custom") {
    const removed = current.customFields.filter(
      (old) => !next.customFields.some((f) => f.key === old.key),
    );
    for (const row of next.customRecords) {
      if (removed.some((f) => Object.hasOwn(row, f.key)))
        fail(422, "删除字段时必须同时核对并移除关联单元格。");
      for (const field of next.customFields) {
        const v = row[field.key];
        if (v === undefined || v === null || v === "") continue;
        if (
          field.type === "number" &&
          (typeof v !== "number" || !Number.isFinite(v))
        )
          fail(422, "数值字段必须为有限数字，留空表示未知。");
        if (field.type === "text") text(v, 100000);
        if (field.type === "date") {
          if (typeof v !== "string") fail(422, "日期字段无效。");
          formDate(v);
        }
      }
    }
  } else if (section !== "habits") {
    for (const row of next[section]) {
      if (section === "todos") {
        formDate(text(row.date, 10, true));
        text(row.title, 100000, true);
      }
      if (row.date !== undefined && row.date !== "") {
        if (typeof row.date !== "string") fail(422, "表单日期无效。");
        formDate(row.date);
      }
      for (const name of textFields[section])
        if (row[name] !== undefined) text(row[name], 100000);
      if (
        ["decisions", "predictions"].includes(section) &&
        row.probability !== undefined &&
        row.probability !== ""
      ) {
        if (
          typeof row.probability !== "number" ||
          !Number.isFinite(row.probability) ||
          row.probability < 0 ||
          row.probability > 100
        )
          fail(422, "自报概率必须为0至100，留空表示未知。");
      }
      if (
        section === "todos" &&
        row.done !== undefined &&
        typeof row.done !== "boolean"
      )
        fail(422, "待办勾选必须明确为完成或未完成。");
    }
  }
  return next;
}
