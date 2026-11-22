import { date as actionDate } from "../actions/action.validation.ts";
import {
  fail,
  identity,
  integer,
  keys,
  object,
  text,
} from "../learning/native-learning.validation.ts";
import type {
  ApplicationData,
  ErrorData,
  ErrorTypeData,
  ExperienceKind,
  ExperienceQuery,
} from "./experience.types.ts";
export function experienceDate(v: unknown) {
  const d = actionDate(v);
  if (d < "0001-01-01") fail(422, "日期须在公历1至9999年，未知请保留为空。");
  return d;
}
export const kinds: ExperienceKind[] = ["application", "error", "error_type"];
export function experienceId(kind: ExperienceKind, id: unknown) {
  const prefix =
    kind === "application"
      ? "application-"
      : kind === "error"
        ? "error-"
        : "errtype-";
  return identity(id, prefix);
}
export function safeExperienceText(
  value: unknown,
  max: number,
  required = false,
) {
  const s = text(value, max * 2, required);
  if (Array.from(s).length > max)
    fail(422, "文本超过字符容量，请保留完整原输入。");
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0 || (c >= 0xdc00 && c <= 0xdfff))
      fail(422, "文本含无效Unicode，请保留原输入并修正。");
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        fail(422, "文本含不完整Unicode，请保留原输入并修正。");
    }
  }
  return s;
}
const nullableText = (v: unknown, max: number) =>
  v === null ? null : safeExperienceText(v, max);
const score = (v: unknown) => (v === null ? null : integer(v, 0, 5));
const moduleId = (v: unknown) => {
  if (v === null) return null;
  const s = safeExperienceText(v, 128, true);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(s)) fail(422, "分类标识无效。");
  return s;
};
export function experienceData(
  kind: ExperienceKind,
  raw: unknown,
): ApplicationData | ErrorData | ErrorTypeData {
  const b = object(raw);
  if (kind === "error_type") {
    keys(b, ["name", "description"]);
    return {
      name: safeExperienceText(b.name, 50, true).trim(),
      description: safeExperienceText(b.description, 200),
    };
  }
  const common = {
    date: b.date === null ? null : experienceDate(b.date),
    module_id: moduleId(b.module_id),
  };
  if (kind === "application") {
    keys(b, ["date", "module_id", "concept", "scenario", "effectiveness"]);
    return {
      ...common,
      concept: safeExperienceText(b.concept, 100, true),
      scenario: nullableText(b.scenario, 500),
      effectiveness: score(b.effectiveness),
    };
  }
  keys(b, [
    "date",
    "module_id",
    "error_type",
    "type_id",
    "description",
    "severity",
    "context",
    "improvement_action",
    "is_repeat",
    "related_error_id",
  ]);
  if (b.is_repeat !== null && typeof b.is_repeat !== "boolean")
    fail(422, "请明确重复标记或保留未知。");
  return {
    ...common,
    error_type: safeExperienceText(b.error_type, 50, true),
    type_id: b.type_id === null ? null : experienceId("error_type", b.type_id),
    description: safeExperienceText(b.description, 500, true),
    severity: score(b.severity),
    context: nullableText(b.context, 500),
    improvement_action: nullableText(b.improvement_action, 500),
    is_repeat: b.is_repeat as boolean | null,
    related_error_id:
      b.related_error_id === null
        ? null
        : experienceId("error", b.related_error_id),
  };
}
export function experienceQuery(
  kind: ExperienceKind,
  raw: Record<string, string | undefined> = {},
): ExperienceQuery {
  keys(
    raw,
    kind === "error_type"
      ? ["cursor", "limit", "archived", "search"]
      : [
          "cursor",
          "limit",
          "archived",
          "date_from",
          "date_to",
          "module_id",
          "error_type",
          "is_repeat",
          "search",
        ],
  );
  const archived = raw.archived ?? "active";
  if (!["active", "archived", "all"].includes(archived))
    fail(422, "归档范围无效。");
  if (raw.is_repeat !== undefined && !["true", "false"].includes(raw.is_repeat))
    fail(422, "重复筛选无效。");
  const from =
      raw.date_from === undefined ? null : experienceDate(raw.date_from),
    to = raw.date_to === undefined ? null : experienceDate(raw.date_to);
  if (from && to && from > to) fail(422, "开始日期不能晚于结束日期。");
  return {
    kind,
    archived: archived as ExperienceQuery["archived"],
    date_from: from,
    date_to: to,
    module_id: raw.module_id === undefined ? null : moduleId(raw.module_id),
    error_type:
      raw.error_type === undefined
        ? null
        : safeExperienceText(raw.error_type, 50, true),
    is_repeat: raw.is_repeat === undefined ? null : raw.is_repeat === "true",
    search: safeExperienceText(raw.search ?? "", 300),
    after: null,
    limit: raw.limit === undefined ? 20 : integer(Number(raw.limit), 1, 50),
  };
}
