import type { AlipayPrices } from "../../src/modules/billing/ainovel-alipay-pricing.ts";
import type { DatabaseSeed } from "../../src/shared/types.ts";

export const TEST_ALIPAY_PRICES: AlipayPrices = {
  plus_monthly: 3800, plus_quarterly: 9800, plus_yearly: 29800,
  pro_monthly: 8800, pro_quarterly: 22800, pro_yearly: 59800,
};

export function seedAlipayPrices(seed: DatabaseSeed): void {
  const record = seed.appConfigs!.find(item => item.appId === "ai_novel" && item.configKey === "admin.delivery_config")!;
  record.configValue = JSON.stringify({ ...JSON.parse(record.configValue), billing: { alipay: { prices: TEST_ALIPAY_PRICES } } });
}
