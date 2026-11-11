import { fail } from "../learning/native-learning.validation.ts";
/** Reject values PostgreSQL JSONB cannot represent, without rewriting user facts. Raw documents use lossless byte encoding instead. */
export function assertReadingJSON(value: unknown): void {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === "string") {
      if (item.includes("\0") || /[\uD800-\uDFFF]/u.test(item))
        fail(
          422,
          "Text contains NUL or an unpaired Unicode surrogate; preserve the original input and correct it before saving.",
        );
    } else if (item && typeof item === "object")
      pending.push(...Object.values(item));
  }
}
