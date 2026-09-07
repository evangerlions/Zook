export type ProviderTone = "bai" | "bailian" | "openrouter" | "volcengine" | "neutral";

export function providerTone(provider: string): ProviderTone {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "bai") return "bai";
  if (normalized === "openrouter") return "openrouter";
  if (normalized.startsWith("volcengine")) return "volcengine";
  if (normalized.startsWith("bailian") || normalized.startsWith("aliyun")) return "bailian";
  return "neutral";
}
