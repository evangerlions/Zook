export const AI_NOVEL_TOKENS_PER_POINT = 12_000;
export const AI_NOVEL_MIN_TOKENS_PER_POINT = 5_000;
export const AI_NOVEL_MAX_TOKENS_PER_POINT = 50_000;

export function isAiNovelTokensPerPoint(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= AI_NOVEL_MIN_TOKENS_PER_POINT
    && value <= AI_NOVEL_MAX_TOKENS_PER_POINT;
}
