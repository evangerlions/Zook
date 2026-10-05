import { PRODUCTS, sourceFromStore } from "./ainovel-billing-values.ts";

/** Explicit, store-scoped mapping. Unknown base plans must never grant access. */
const GOOGLE_PRODUCTS = new Map(Object.keys(PRODUCTS).map(key => [`${key}:auto-renew`, key]));

export function billingProductKey(store: unknown, productId: unknown): string | undefined {
  if (typeof productId !== "string") return undefined;
  const source = sourceFromStore(store);
  if (source === "play_store") return GOOGLE_PRODUCTS.get(productId);
  if (source === "app_store" && Object.hasOwn(PRODUCTS, productId)) return productId;
  return undefined;
}

export function billingStoreProductId(productKey: string, google: boolean): string {
  return google ? `${productKey}:auto-renew` : productKey;
}

export function revenueCatAppForStore(store: unknown, appleAppId?: string, googleAppId?: string): string | undefined {
  const source = sourceFromStore(store);
  return source === "app_store" ? appleAppId?.trim() : source === "play_store" ? googleAppId?.trim() : undefined;
}
