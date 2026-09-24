import type { AiNovelBillingTier } from "../../shared/types.ts";

export const REVENUECAT_ENTITLEMENT_IDS: Readonly<
  Record<AiNovelBillingTier, string>
> = {
  plus: "orangewrite_plus",
  pro: "orangewrite_pro",
};
