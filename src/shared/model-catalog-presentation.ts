/** Public display metadata only; never contains provider routing or credentials. */
export interface ModelCatalogPresentation {
  modelKey: string;
  label?: string;
  description?: string;
  badge?: string;
  localIcon?: string;
  onlineIcon?: string;
  enabled?: boolean;
  sortOrder?: number;
}

export const MODEL_LOCAL_ICONS = ["generic", "deepseek", "kimi", "qwen", "doubao", "minimax", "gemini", "claude", "grok", "zai", "openai"] as const;

export function defaultModelLocalIcon(key: string): string {
  const family = MODEL_LOCAL_ICONS.find((icon) => key.startsWith(icon));
  if (family) return family;
  if (key.startsWith("glm")) return "zai";
  if (key.startsWith("gpt") || /^o[134](?:-|$)/.test(key)) return "openai";
  return "generic";
}

export function parseModelCatalogPresentation(value: unknown): ModelCatalogPresentation[] {
  if (!Array.isArray(value)) throw new Error("catalog must be an array.");
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid catalog entry.");
    const row = item as Record<string, unknown>;
    const allowed = ["modelKey", "label", "description", "badge", "localIcon", "onlineIcon", "enabled", "sortOrder"];
    if (Object.keys(row).some((key) => !allowed.includes(key))) throw new Error("Unsupported catalog field.");
    if (typeof row.modelKey !== "string" || !row.modelKey.trim()) throw new Error("catalog.modelKey is required.");
    const result: ModelCatalogPresentation = { modelKey: row.modelKey.trim() };
    if (seen.has(result.modelKey)) throw new Error("Duplicate catalog modelKey.");
    seen.add(result.modelKey);
    for (const key of ["label", "description", "badge", "localIcon", "onlineIcon"] as const) {
      if (row[key] === undefined) continue;
      if (typeof row[key] !== "string" || row[key].length > (key === "description" ? 2000 : 512)) throw new Error(`Invalid catalog.${key}.`);
      result[key] = row[key].trim();
    }
    if (result.label === "") throw new Error("catalog.label cannot be empty.");
    if (result.localIcon && !(MODEL_LOCAL_ICONS as readonly string[]).includes(result.localIcon)) throw new Error("Unknown catalog.localIcon.");
    if (result.onlineIcon) {
      let url: URL;
      try { url = new URL(result.onlineIcon); } catch { throw new Error("Invalid catalog.onlineIcon URL."); }
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("catalog.onlineIcon must be a public HTTPS URL without credentials.");
    }
    if (row.enabled !== undefined) {
      if (typeof row.enabled !== "boolean") throw new Error("catalog.enabled must be boolean.");
      result.enabled = row.enabled;
    }
    if (row.sortOrder !== undefined) {
      if (typeof row.sortOrder !== "number" || !Number.isSafeInteger(row.sortOrder)) throw new Error("catalog.sortOrder must be an integer.");
      result.sortOrder = row.sortOrder;
    }
    return result;
  });
}
