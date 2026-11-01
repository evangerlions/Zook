/** Product display estimate only; settlement must use actual token buckets. */
export function estimateAiNovelDisplayMultiplier(input: number, output: number): number {
  // Historical token mix, no cache hits, base context tier.
  const raw = input * 0.9451 + output * 0.0549;
  if (raw === 0) return 0;
  const tenths = Math.round(raw * 10) / 10;
  return tenths >= 0.9 ? Math.round(raw * 2) / 2 : Math.max(0.1, tenths);
}
