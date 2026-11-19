import type { LightTickOwner } from "../../lighttick.types.ts";

export type Bucket = {
  id: string;
  name: string;
  purpose: string;
} & (
  | { kind: "holding"; target_weight: string | null }
  | { kind: "watch"; instrument_ids: string[]; assumption: string }
);

export interface Allocation {
  bucket_id: string;
  instrument_id: string;
  quantity: string;
}
export interface BucketSnapshot {
  revision: number;
  account_id: string;
  base_account_revision: number;
  effective_at: string | null;
  buckets: Bucket[];
  allocations: Allocation[];
}
export type BucketVersion = Pick<BucketSnapshot, "revision" | "effective_at" | "base_account_revision">;
export interface BucketRepository {
  get(owner: LightTickOwner, account: string, revision?: number): Promise<BucketSnapshot | undefined>;
  versions(owner: LightTickOwner, account: string): Promise<BucketVersion[]>;
  append(owner: LightTickOwner, snapshot: BucketSnapshot): Promise<void>;
  export(owner: LightTickOwner): Promise<BucketSnapshot[]>;
}
export interface BucketHolding {
  instrument_id: string;
  quantity: string;
  allocated: string;
  unallocated: string | null;
  excess: string;
  quantity_verified: boolean;
  price: string | null;
}
export interface BucketMetric {
  market_value: string | null;
  actual_weight: string | null;
  deviation: string | null;
  coverage: { available: number; required: number };
}
export interface BucketView {
  snapshot: BucketSnapshot;
  account_revision: number;
  holdings: BucketHolding[];
  metrics: Record<string, BucketMetric>;
  unallocated: BucketMetric;
  valuation: {
    id: string;
    date: string;
    status: "available" | "stale" | "holdings_changed" | "partial";
  } | null;
  holdings_value: string | null;
  unallocated_cash: string | null;
  needs_review: boolean;
  history: BucketVersion[];
}
