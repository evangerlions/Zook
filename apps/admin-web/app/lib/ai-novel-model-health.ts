export type AiNovelModelHealthTone = "healthy" | "warning" | "critical";

export function aiNovelModelHealthTone(score: number): AiNovelModelHealthTone {
  if (score >= 95) return "healthy";
  if (score >= 80) return "warning";
  return "critical";
}

export function aiNovelModelHealthColor(score: number): "success" | "warning" | "error" {
  const tone = aiNovelModelHealthTone(score);
  return tone === "healthy" ? "success" : tone === "warning" ? "warning" : "error";
}
