import type {
  BillingPlatform,
  BillingProduct,
  BillingProductKey,
  CatalogData,
  DistributionChannel,
} from "../../generated/openapi/public-contracts.generated.ts";
import type { AccountRegion } from "../../shared/types.ts";

export interface AiNovelBillingCatalogInput {
  accountRegion: AccountRegion;
  platform: BillingPlatform;
  distribution: DistributionChannel;
}

type ProductDefinition = Pick<
  BillingProduct,
  "productKey" | "tier" | "billingPeriod"
>;
type ProductProvider = BillingProduct["providers"][number];

const PRODUCT_DEFINITIONS: readonly ProductDefinition[] = [
  { productKey: "plus_monthly", tier: "plus", billingPeriod: "P1M" },
  { productKey: "plus_quarterly", tier: "plus", billingPeriod: "P3M" },
  { productKey: "plus_yearly", tier: "plus", billingPeriod: "P1Y" },
  { productKey: "pro_monthly", tier: "pro", billingPeriod: "P1M" },
  { productKey: "pro_quarterly", tier: "pro", billingPeriod: "P3M" },
  { productKey: "pro_yearly", tier: "pro", billingPeriod: "P1Y" },
  { productKey: "max_monthly", tier: "max", billingPeriod: "P1M" },
  { productKey: "max_quarterly", tier: "max", billingPeriod: "P3M" },
  { productKey: "max_yearly", tier: "max", billingPeriod: "P1Y" },
];

const MOCK_ALIPAY_PRICES: Record<BillingProductKey, number> = {
  plus_monthly: 3990,
  plus_quarterly: 9990,
  plus_yearly: 29900,
  pro_monthly: 10900,
  pro_quarterly: 26900,
  pro_yearly: 79900,
  max_monthly: 19900,
  max_quarterly: 49900,
  max_yearly: 159900,
};

export function buildAiNovelBillingCatalog(
  input: AiNovelBillingCatalogInput,
): CatalogData {
  return {
    accountRegion: input.accountRegion,
    platform: input.platform,
    distribution: input.distribution,
    products: PRODUCT_DEFINITIONS.map((product) => ({
      ...product,
      providers: [resolveProvider(input, product)],
    })),
  };
}

export function isAiNovelBillingChannelSupported(
  input: AiNovelBillingCatalogInput,
): boolean {
  if (input.platform === "ios" || input.platform === "macos") {
    return input.distribution === "app_store";
  }
  if (input.platform === "web") {
    return input.distribution === "web";
  }
  if (input.platform === "windows") {
    return input.distribution === "windows";
  }
  if (input.accountRegion === "CN") {
    return (
      input.distribution === "china_android_store" ||
      input.distribution === "direct_android"
    );
  }
  if (input.accountRegion === "GLOBAL") {
    return (
      input.distribution === "google_play" ||
      input.distribution === "direct_android"
    );
  }
  return false;
}

function resolveProvider(
  input: AiNovelBillingCatalogInput,
  product: ProductDefinition,
): ProductProvider {
  if (isRevenueCatDistribution(input)) {
    return {
      provider: "revenuecat",
      available: true,
      blockedReason: null,
      providerProductId: `mock_${input.distribution}_${product.productKey}`,
      providerPackageId: null,
      providerEntitlementId: product.tier,
      price: null,
    };
  }

  if (isChinaAlipayDistribution(input)) {
    return {
      provider: "alipay",
      available: true,
      blockedReason: null,
      providerProductId: `mock_alipay_${product.productKey}`,
      providerPackageId: null,
      providerEntitlementId: product.tier,
      price: {
        amountMinor: MOCK_ALIPAY_PRICES[product.productKey],
        currency: "CNY",
      },
    };
  }

  return {
    provider: input.accountRegion === "GLOBAL" ? "revenuecat" : "alipay",
    available: false,
    blockedReason: "provider_unavailable",
    providerProductId: null,
    providerPackageId: null,
    providerEntitlementId: product.tier,
    price: null,
  };
}

function isRevenueCatDistribution(input: AiNovelBillingCatalogInput): boolean {
  return (
    ((input.platform === "ios" || input.platform === "macos") &&
      input.distribution === "app_store") ||
    (input.accountRegion === "GLOBAL" &&
      input.platform === "android" &&
      input.distribution === "google_play")
  );
}

function isChinaAlipayDistribution(input: AiNovelBillingCatalogInput): boolean {
  if (input.accountRegion !== "CN") {
    return false;
  }

  if (
    input.platform === "android" &&
    (input.distribution === "china_android_store" ||
      input.distribution === "direct_android")
  ) {
    return true;
  }

  return (
    (input.platform === "web" || input.platform === "windows") &&
    (input.distribution === "web" || input.distribution === "windows")
  );
}
