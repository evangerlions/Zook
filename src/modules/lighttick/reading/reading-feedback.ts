import type { ReadingArticle, ReadingFeedback } from "./reading.types.ts";
import {
  fail,
  integer,
  keys,
  object,
  text,
} from "../learning/native-learning.validation.ts";
export function hasReadingFeedback(row: ReadingArticle) {
  const f = row.personal.structured_feedback;
  return (
    !!row.personal.feedback ||
    (!!f &&
      !!(
        f.value ||
        f.difficulty ||
        f.takeaway ||
        f.question ||
        f.action ||
        f.tags.length
      ))
  );
}
export function writeReadingFeedback(
  row: ReadingArticle,
  raw: unknown,
  now: string,
) {
  const b = object(raw);
  keys(b, [
    "base_revision",
    "content_version",
    "base_feedback_revision",
    "feedback",
    "mark_read",
  ]);
  if (row.archived) fail(409, "请先恢复文章，再填写结构化反馈。");
  if (b.content_version !== row.content_version)
    fail(409, "原文版本已变化，请保留反馈输入核对。");
  const previous = row.personal.structured_feedback;
  if (
    (previous?.version ?? 0) !==
    integer(b.base_feedback_revision, 0, 2147483646)
  )
    fail(409, "阅读反馈已在其他页面更新，请保留本机输入核对。");
  const f = object(b.feedback);
  keys(f, ["value", "difficulty", "takeaway", "question", "action", "tags"]);
  if (
    !["", "insightful", "neutral", "not_for_me"].includes(String(f.value)) ||
    !["", "easy", "right", "hard"].includes(String(f.difficulty))
  )
    fail(422, "请选择有效的阅读价值与难度。");
  if (!Array.isArray(f.tags) || f.tags.length > 8)
    fail(422, "反馈标签最多8项。");
  const tags = [...new Set(f.tags.map((t) => text(t, 32, true).trim()))];
  if (typeof b.mark_read !== "boolean")
    fail(422, "请明确是否确认本版本已读完。");
  const feedback: ReadingFeedback = {
    version: (previous?.version ?? 0) + 1,
    value: f.value as ReadingFeedback["value"],
    difficulty: f.difficulty as ReadingFeedback["difficulty"],
    takeaway: text(f.takeaway, 4000).trim(),
    question: text(f.question, 2000).trim(),
    action: text(f.action, 2000).trim(),
    tags,
    updated_at: now,
  };
  row.personal.structured_feedback = feedback;
  if (b.mark_read) {
    row.personal.read = true;
    row.personal.read_at ??= now;
  }
}
export function readingSearchText(row: ReadingArticle) {
  const c = row.content,
    f = row.personal.structured_feedback;
  return [
    c.title,
    c.translated_title,
    c.author,
    c.publisher,
    c.description,
    c.body,
    c.access,
    c.recommendation_reason,
    ...(c.tags ?? []),
    ...(c.topics ?? []),
    row.personal.notes,
    row.personal.feedback,
    f?.takeaway,
    f?.question,
    f?.action,
    ...(f?.tags ?? []),
    ...(row.materials ?? []).flatMap((m) => [m.draft.text, m.adopted?.text]),
  ]
    .filter((v) => typeof v === "string")
    .join("\n");
}
