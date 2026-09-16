export type LlmSeriesToneClass =
  | "model-card--qwen"
  | "model-card--deepseek"
  | "model-card--kimi"
  | "model-card--glm"
  | "model-card--doubao"
  | "model-card--minimax"
  | "model-card--series-blue"
  | "model-card--series-violet"
  | "model-card--series-amber"
  | "model-card--series-teal";

const KNOWN_SERIES_TONES: Record<string, LlmSeriesToneClass> = {
  qwen: "model-card--qwen",
  deepseek: "model-card--deepseek",
  kimi: "model-card--kimi",
  glm: "model-card--glm",
  doubao: "model-card--doubao",
  minimax: "model-card--minimax",
};

const FALLBACK_SERIES_TONES: LlmSeriesToneClass[] = [
  "model-card--series-blue",
  "model-card--series-violet",
  "model-card--series-amber",
  "model-card--series-teal",
];

export function getLlmSeriesToneClass(modelName: string): LlmSeriesToneClass {
  const firstWord = modelName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const normalizedSeries = firstWord.replace(/[^a-z0-9]/g, "");
  const knownSeries = Object.keys(KNOWN_SERIES_TONES).find((series) => normalizedSeries.startsWith(series));

  if (knownSeries) {
    return KNOWN_SERIES_TONES[knownSeries];
  }

  const hash = [...normalizedSeries].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return FALLBACK_SERIES_TONES[hash % FALLBACK_SERIES_TONES.length] ?? FALLBACK_SERIES_TONES[0];
}
