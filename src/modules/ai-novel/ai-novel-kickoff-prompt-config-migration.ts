import type { VersionedAppConfigService } from "../../services/versioned-app-config.service.ts";
import {
  defaultAiNovelKickoffRecommendedPrompts,
  defaultAiNovelLegacyRecommendedPrompts,
} from "./ai-novel-kickoff-prompt-defaults.ts";

const AI_NOVEL_APP_ID = "ai_novel";
const DELIVERY_CONFIG_KEY = "admin.delivery_config";

export async function migrateAiNovelKickoffPromptConfig(
  appConfigService: VersionedAppConfigService,
): Promise<boolean> {
  const current = await appConfigService.getValue(
    AI_NOVEL_APP_ID,
    DELIVERY_CONFIG_KEY,
  );
  const migrated = normalizeAiNovelKickoffPromptConfig(current);
  if (!migrated) {
    return false;
  }
  await appConfigService.setValue(
    AI_NOVEL_APP_ID,
    DELIVERY_CONFIG_KEY,
    migrated,
    "backfill localized AINovel kickoff prompts",
  );
  return true;
}

export function normalizeAiNovelKickoffPromptConfig(
  rawConfig: string | undefined,
): string | undefined {
  const config = parseConfig(rawConfig);
  if (!config) {
    return undefined;
  }
  if (config.kickoff === undefined) {
    config.kickoff = {};
  }
  if (!isRecord(config.kickoff)) {
    return undefined;
  }
  const kickoff = config.kickoff;
  const legacyPrompts = asPromptList(kickoff.recommendedPrompts);
  const existingLocalized = isRecord(kickoff.recommendedPromptsI18n)
    ? kickoff.recommendedPromptsI18n
    : {};
  const localized: Record<string, string[]> = {};
  for (const [locale, defaults] of Object.entries(
    defaultAiNovelKickoffRecommendedPrompts,
  )) {
    localized[locale] = asPromptList(existingLocalized[locale]) ?? [...defaults];
  }
  const existingZhCn = asPromptList(existingLocalized["zh-CN"]);
  if (!existingZhCn && legacyPrompts) {
    localized["zh-CN"] = legacyPrompts;
  }
  const localizedZhCn = localized["zh-CN"]!;
  const compatibleLegacy = legacyPrompts ?? localizedZhCn ?? [
    ...defaultAiNovelLegacyRecommendedPrompts,
  ];
  const changed =
    !sameLocalizedPrompts(existingLocalized, localized) ||
    !samePrompts(kickoff.recommendedPrompts, compatibleLegacy);
  if (!legacyPrompts) {
    kickoff.recommendedPrompts = compatibleLegacy;
  }
  if (!changed) {
    return undefined;
  }
  kickoff.recommendedPromptsI18n = localized;
  return JSON.stringify(config, null, 2);
}

function parseConfig(rawConfig: string | undefined): Record<string, unknown> | undefined {
  if (!rawConfig) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(rawConfig);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asPromptList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.length) {
    return undefined;
  }
  const prompts = value.filter(
    (prompt): prompt is string => typeof prompt === "string" && prompt.trim().length > 0,
  );
  return prompts.length === value.length ? prompts : undefined;
}

function samePrompts(value: unknown, expected: string[]): boolean {
  const prompts = asPromptList(value);
  return Boolean(
    prompts &&
      prompts.length === expected.length &&
      prompts.every((prompt, index) => prompt === expected[index]),
  );
}

function sameLocalizedPrompts(
  value: Record<string, unknown>,
  expected: Record<string, string[]>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === Object.keys(expected).length &&
    keys.every((key) => key in expected && samePrompts(value[key], expected[key]!));
}
