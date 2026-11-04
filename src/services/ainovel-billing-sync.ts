import type { MembershipSyncInput, MembershipSyncResult } from "../modules/billing/membership-sync.ts";
/** One application entry; provider workflows share their canonical evidence writers. */
export function syncMembership(input: MembershipSyncInput, providers: {
  alipay: () => Promise<MembershipSyncResult>; revenuecat: () => Promise<MembershipSyncResult>;
}): Promise<MembershipSyncResult> {
  input.signal?.throwIfAborted();
  switch (input.provider) {
    case "alipay": return providers.alipay();
    case "revenuecat": return providers.revenuecat();
  }
}
