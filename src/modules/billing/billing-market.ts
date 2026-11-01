import { ApplicationError } from '../../shared/errors.ts';

export const BILLING_MARKETS = ['app_store','google_play','xiaomi','vivo','oppo','huawei','honor','direct'] as const;
export type BillingMarket = typeof BILLING_MARKETS[number];
interface MarketEvidence { market?: BillingMarket | null; source?: string | null; distribution?: string | null }

/** Explicit build provenance wins; only exact store/direct evidence fills legacy gaps. */
export function billingMarket(evidence: MarketEvidence): BillingMarket | null {
  if (evidence.market) return evidence.market;
  if (evidence.source === 'app_store') return 'app_store';
  if (evidence.source === 'play_store') return 'google_play';
  return ['direct_android','web','windows'].includes(evidence.distribution ?? '') ? 'direct' : null;
}

export function validateAlipayMarket(market: unknown, distribution: string): void {
  if (market === undefined || market === null) return;
  const allowed = distribution === 'china_android_store'
    ? ['xiaomi','vivo','oppo','huawei','honor','direct'] : ['direct'];
  if (typeof market !== 'string' || !allowed.includes(market))
    throw new ApplicationError(400,'REQ_INVALID_BODY','Market does not match this Alipay distribution.');
}
