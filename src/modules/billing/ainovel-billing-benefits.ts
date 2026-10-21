import { LOCAL_CREDIT_QUOTAS } from "../ai-novel/credits/ai-novel-credits-model.ts";
import { DEFAULT_APP_I18N_SETTINGS, isI18nText, pickI18nText, type I18nText } from "../../shared/i18n.ts";
import type { BillingTier } from "../../generated/openapi/public-contracts.generated.ts";
import { BENEFIT_TRANSLATIONS, FREE_ALLOWANCE_MULTIPLIER } from "./ainovel-billing-benefits-locales.ts";

export const BILLING_BENEFITS_CONFIG_KEY = "ai_novel.billing_benefits";
type BenefitDefinition = { key: string; text: I18nText; included: boolean; order: number; comingSoon: boolean };
type BenefitsConfig = Record<"plus" | "pro", BenefitDefinition[]>;
const text = (zh: string, en: string, tw: string): I18nText => ({ "zh-CN": zh, "en-US": en, "zh-TW": tw });

function defaults(tier: "plus" | "pro"): BenefitDefinition[] {
  const pro = tier === "pro";
  const labels = [
    text("每周享有 {credits} credits", "{credits} credits every week", "每週享有 {credits} credits"),
    pro ? text("优先体验最新、最强的创作模型", "Early access to our latest, most capable writing models", "優先體驗最新、最強的創作模型")
      : text("使用高级创作模型", "Access advanced writing models", "使用進階創作模型"),
    pro ? text("高峰期极速响应", "Ultra-fast responses during peak hours", "尖峰時段極速回應")
      : text("高峰期优先响应", "Priority responses during peak hours", "尖峰時段優先回應"),
    pro ? text("包含 Plus 的所有权益", "Includes all Plus benefits", "包含 Plus 的所有權益")
      : text("包含免费版的所有权益", "Includes all Free plan benefits", "包含免費版的所有權益"),
    pro ? text("更大记忆容量，记住更多故事细节", "More memory for richer story details", "更大記憶容量，記住更多故事細節")
      : text("长期记忆，记住角色与故事设定", "Long-term memory for characters and story settings", "長期記憶，記住角色與故事設定"),
    pro ? text("支持更多设备同步 · 即将推出", "Sync across more devices · Coming soon", "支援更多裝置同步 · 即將推出")
      : text("跨设备同步作品 · 即将推出", "Sync your work across devices · Coming soon", "跨裝置同步作品 · 即將推出"),
  ];
  const translationIndices = [0, pro ? 2 : 1, pro ? 4 : 3, pro ? 6 : 5, pro ? 8 : 7, pro ? 10 : 9];
  for (const [locale, row] of Object.entries(BENEFIT_TRANSLATIONS)) {
    labels.forEach((label, index) => { label[locale] = row[translationIndices[index]]; });
  }
  for (const locale of Object.keys(labels[0])) {
    labels[0][locale] += FREE_ALLOWANCE_MULTIPLIER[locale];
  }
  return ["usage", "models", "priority", "base", "memory", "sync"].map((key, index) => ({
    key, text: labels[index], included: true, order: index + 1, comingSoon: key === "sync",
  }));
}

/** Existing app-config storage can replace either tier's display configuration.
 * This describes marketing benefits, not authorization or a second quota policy. */
export function parseBillingBenefitsConfig(raw?: string): BenefitsConfig {
  const fallback = { plus: defaults("plus"), pro: defaults("pro") };
  if (raw === undefined) return fallback;
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid billing benefits configuration");
  for (const tier of ["plus", "pro"] as const) {
    if (value[tier] === undefined) continue;
    if (!Array.isArray(value[tier]) || value[tier].length > 30) throw new Error(`Invalid billing benefits: ${tier}`);
    const keys = new Set<string>();
    for (const item of value[tier]) {
      if (!item || typeof item.key !== "string" || !item.key || keys.has(item.key) ||
        !isI18nText(item.text) || !Object.values(item.text).some(v => v.trim()) ||
        typeof item.included !== "boolean" || !Number.isSafeInteger(item.order) ||
        typeof item.comingSoon !== "boolean") throw new Error(`Invalid billing benefit: ${tier}`);
      keys.add(item.key);
    }
    fallback[tier] = value[tier];
  }
  return fallback;
}

export function billingBenefits(tier: BillingTier, locale = "en-US", rawConfig?: string) {
  const config = parseBillingBenefitsConfig(rawConfig);
  const credits = LOCAL_CREDIT_QUOTAS[tier];
  return config[tier].slice().sort((a, b) => a.order - b.order).map(item => ({
    key: item.key,
    text: pickI18nText(item.text, locale, DEFAULT_APP_I18N_SETTINGS)
      .replaceAll("{credits}", String(credits))
      .replaceAll("{multiple}", String(credits / LOCAL_CREDIT_QUOTAS.free)),
    included: item.included,
    order: item.order,
    comingSoon: item.comingSoon,
  }));
}
