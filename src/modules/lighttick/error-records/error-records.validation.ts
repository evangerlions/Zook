import { ApplicationError } from "../../../shared/errors.ts";
import type { ErrorQuery } from "./error-records.types.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
export const invalid = (m: string) =>
  new ApplicationError(422, "VALIDATION_ERROR", m);
export function calendarDate(s: unknown): string {
  if (
    typeof s !== "string" ||
    !/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s + "T00:00:00Z")) ||
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s
  )
    throw invalid("日期必须是有效的 YYYY-MM-DD。");
  return s;
}
export function errorId(s: unknown) {
  if (typeof s !== "string" || !/^error-[a-zA-Z0-9-]{1,100}$/.test(s))
    throw invalid("错误记录编号无效。");
  return s;
}
export function errorQuery(
  q: Record<string, string | undefined>,
  now: Date,
  timezone: string,
): ErrorQuery {
  const today = businessDateAt(now, timezone),
    date_to = calendarDate(q.date_to ?? today),
    date_from = calendarDate(
      q.date_from ??
        new Date(Date.parse(date_to + "T00:00:00Z") - 29 * 86400000)
          .toISOString()
          .slice(0, 10),
    );
  if (
    date_from > date_to ||
    (Date.parse(date_to) - Date.parse(date_from)) / 86400000 > 365
  )
    throw invalid("回看范围须为 1–366 天。");
  const qtext = (q.q ?? "").trim(),
    module = q.module_id ?? "",
    category = q.category_id ?? "",
    repeat = q.repeat ?? "",
    archived = q.archived ?? "false";
  if (
    qtext.length > 200 ||
    qtext.includes("\0") ||
    module.length > 100 ||
    category.length > 100 ||
    !["", "true", "false"].includes(repeat) ||
    !["true", "false"].includes(archived)
  )
    throw invalid("筛选条件无效。");
  const num = (s: string | undefined, n: number, max: number) => {
    if (s === undefined) return n;
    if (
      !/^[1-9]\d*$/.test(s) ||
      !Number.isSafeInteger(Number(s)) ||
      Number(s) > max
    )
      throw invalid("分页条件无效。");
    return Number(s);
  };
  return {
    date_from,
    date_to,
    module_id: module,
    category_id: category,
    repeat: repeat as ErrorQuery["repeat"],
    archived: archived === "true",
    q: qtext,
    page: num(q.page, 1, 1000000),
    page_size: num(q.page_size, 20, 50),
  };
}
