import type { ReadingSourceRange } from "./reading-ai.types.ts";
import {
  fail,
  integer,
  keys,
  object,
} from "../learning/native-learning.validation.ts";
/** Offsets are Unicode code points, never UTF-16 units or a silent prefix. */
export function readingSelectedText(
  body: string,
  paragraph: unknown,
  rawRange?: unknown,
) {
  const characters = Array.from(body);
  let start = 0,
    end = characters.length;
  if (rawRange !== undefined) {
    if (paragraph !== null) fail(422, "字符范围不能同时选择旧段落编号。");
    const r = object(rawRange);
    keys(r, ["start", "end"]);
    start = integer(r.start, 0, characters.length - 1);
    end = integer(r.end, start + 1, characters.length);
  } else if (paragraph !== null) {
    if (typeof paragraph !== "string" || !/^p-[1-9][0-9]{0,5}$/.test(paragraph))
      fail(422, "请选择此原文中的段落。");
    const index = Number(paragraph.slice(2)) - 1,
      parts = body.split(/\n\s*\n/);
    if (index >= parts.length) fail(422, "请选择此原文中的段落。");
    const boundaries = [...body.matchAll(/\n\s*\n/g)];
    const offset =
      index === 0
        ? 0
        : boundaries[index - 1].index! + boundaries[index - 1][0].length;
    start = Array.from(body.slice(0, offset)).length;
    end = start + Array.from(parts[index]).length;
  }
  const text = characters.slice(start, end).join("");
  if (!text.trim()) fail(422, "选定原文范围不能为空。");
  return { text, range: { start, end } as ReadingSourceRange };
}
export function sameReadingRange(
  a?: ReadingSourceRange,
  b?: ReadingSourceRange,
) {
  return a?.start === b?.start && a?.end === b?.end;
}
