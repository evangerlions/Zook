import { ApplicationError } from "../../../shared/errors.ts";
import {
  canonical,
  digest,
  integer,
  keys,
  object,
  text,
} from "../actions/action.validation.ts";
import type {
  LearningAnswer,
  NativePrivateState,
} from "./native-learning.types.ts";
export { canonical, digest, integer, keys, object, text };
export function fail(status: number, message: string): never {
  throw new ApplicationError(
    status,
    status === 404
      ? "LIGHTTICK_RESOURCE_NOT_FOUND"
      : status === 409
        ? "LIGHTTICK_VERSION_CONFLICT"
        : status === 503
          ? "LIGHTTICK_APP_DISABLED"
          : "VALIDATION_ERROR",
    message,
  );
}
export function identity(value: unknown, prefix?: string) {
  const id = text(value, 128, true);
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id) || (prefix && !id.startsWith(prefix)) || (prefix === 'lesson-' && !/^lesson-[a-z0-9-]+$/.test(id)))
    fail(422, "Invalid learning identity.");
  return id;
}
export function collectionIdentity(value: unknown) {
  const id = text(value, 100, true);
  if (/[\x00-\x1f\x7f]/.test(id)) fail(422, "Invalid collection identity.");
  return id;
}
export function version(value: unknown) {
  const v = text(value, 64, true);
  if (!/^[a-f0-9]{64}$/.test(v)) fail(422, "Invalid content version.");
  return v;
}
export function answers(value: unknown): LearningAnswer[] {
  if (!Array.isArray(value) || value.length > 100)
    fail(422, "At most 100 answers are supported.");
  const seen = new Set<string>();
  let size = 0;
  return value.map((v) => {
    const x = object(v);
    keys(x, ["id", "prompt", "answer"]);
    const id = text(x.id, 500, true);
    if (seen.has(id)) fail(422, "Duplicate answer identity.");
    seen.add(id);
    const answer = text(x.answer, 10000);
    size += answer.length;
    if (size > 60000) fail(422, "Answers exceed capacity.");
    return { id, prompt: text(x.prompt, 1000), answer };
  });
}
export function privateData(r: NativePrivateState) {
  return {
    lesson_id: r.lessonId,
    content_version: r.contentVersion,
    revision: r.revision,
    draft_version: r.draftVersion ?? r.contentVersion,
    notes_revision: r.notesRevision,
    position_revision: r.positionRevision,
    completion_revision: r.completionRevision,
    notes: r.notes,
    answers: r.answers,
    position: r.position,
    completed: r.completed,
    completed_at: r.completedAt,
    updated_at: r.updatedAt,
  };
}
export function legacyState(
  r: NativePrivateState,
  questions: LearningAnswer[] = [],
) {
  return {
    id: r.lessonId,
    content_version: r.contentVersion,
    draft_version: r.draftVersion ?? r.contentVersion,
    revision: r.revision,
    notes: r.notes,
    answers: r.answers,
    questions,
    position: r.position,
    completed: r.completed,
    completed_at: r.completedAt,
    updated_at: r.updatedAt,
  };
}
