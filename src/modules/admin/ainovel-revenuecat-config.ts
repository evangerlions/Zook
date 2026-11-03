/** Remove obsolete client SDK settings from AINovel delivery configuration. */
export function cleanAiNovelRevenueCatConfig(appId: string, rawJson: string): string {
  if (appId !== "ai_novel") return rawJson;
  const config = JSON.parse(rawJson) as Record<string, unknown>;
  const billing = config.billing;
  if (!billing || typeof billing !== "object" || Array.isArray(billing)) return rawJson;
  const revenueCat = (billing as Record<string, unknown>).revenueCat;
  if (!revenueCat || typeof revenueCat !== "object" || Array.isArray(revenueCat)) return rawJson;
  const values = revenueCat as Record<string, unknown>;
  delete values.enabled;
  delete values.configVersion;
  delete values.publicSdkKeys;
  return JSON.stringify(config, null, 2);
}
