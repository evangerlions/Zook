import { randomBytes } from "node:crypto";
import { ApplicationError } from "../../shared/errors.ts";
import type { AlipayPlatform, AlipayProductKey } from "./alipay-models.ts";

const SCENES = { android: "and", web: "web", windows: "win" } as const satisfies Record<AlipayPlatform, string>;
const PRODUCTS = { plus_monthly: "a01", plus_quarterly: "a03", plus_yearly: "a12",
  pro_monthly: "b01", pro_quarterly: "b03", pro_yearly: "b12" } as const satisfies Record<AlipayProductKey, string>;

// Legacy IDs remain valid for financial history and interrupted checkout recovery.
export const ALIPAY_ORDER_ID_PATTERN = /^(?:ow_(?:and|web|win)_[ab](?:01|03|12)_[A-Za-z0-9_-]{1,6}_[a-f0-9]{16}|(?:ow|alp)_[a-f0-9]{32})$/;

export function createAlipayOrderId(platform: AlipayPlatform, product: AlipayProductKey, userId: string): string {
  const userPrefix = userId.slice(0, 6);
  if (!/^[A-Za-z0-9_-]{1,6}$/.test(userPrefix)) {
    throw new ApplicationError(400, "BILLING_ACCOUNT_UNAVAILABLE", "User identity cannot be represented in the merchant order number.");
  }
  return `ow_${SCENES[platform]}_${PRODUCTS[product]}_${userPrefix}_${randomBytes(8).toString("hex")}`;
}
