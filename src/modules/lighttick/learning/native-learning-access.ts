import type { LearningAuthority } from "./native-learning.types.ts";

export const NATIVE_LEARNING_READING_PHASE = "zook";

export function canReadNativeLearning(authority: LearningAuthority | undefined): boolean {
  return authority?.phase === NATIVE_LEARNING_READING_PHASE && authority.readingEnabled;
}
