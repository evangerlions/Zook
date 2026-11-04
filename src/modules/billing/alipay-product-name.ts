import type { AlipayProductKey } from "./alipay-models.ts";

/** Alipay is a CN checkout; its customer-visible subject uses the product brand
 * and a complete plan name, never the internal product key. */
const ALIPAY_PRODUCT_NAMES = {
  plus_monthly: "橘子写作 Plus 月度会员",
  plus_quarterly: "橘子写作 Plus 季度会员",
  plus_yearly: "橘子写作 Plus 年度会员",
  pro_monthly: "橘子写作 Pro 月度会员",
  pro_quarterly: "橘子写作 Pro 季度会员",
  pro_yearly: "橘子写作 Pro 年度会员",
} satisfies Record<AlipayProductKey, string>;

export function alipayProductName(productKey: AlipayProductKey): string {
  return ALIPAY_PRODUCT_NAMES[productKey];
}
