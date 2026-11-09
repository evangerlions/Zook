import type { LightTickOwner } from "../../lighttick.types.ts";
import type { DailyDataset, DailySupplier } from "./market.types.ts";
import type { dailyIndicators } from "./market.indicators.ts";
export interface MarketInput {
  instrument_id: string;
  base_revision: number;
  supplier: DailySupplier;
  start: string;
  end: string;
  csv?: string;
  declared_source?: string;
  volume_unit?: "shares" | "lots100";
  amount_unit?: "CNY" | "thousand_CNY" | "ten_thousand_CNY";
}
export interface MarketWork extends LightTickOwner {
  id: string;
  instrument_id: string;
  base_revision: number;
  revision: number;
  request_key: string;
  input: MarketInput;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempt: number;
  fence: string | null;
  lease_until: string | null;
  error_code: string | null;
  snapshot_id: string | null;
  created_at: string;
  updated_at: string;
}
export interface MarketSnapshot {
  id: string;
  revision: 1;
  instrument_id: string;
  instrument_revision: number;
  work_id: string;
  created_at: string;
  dataset: DailyDataset;
  indicators: ReturnType<typeof dailyIndicators>;
}
export type MarketSnapshotSummary = Pick<
  MarketSnapshot,
  | "id"
  | "revision"
  | "instrument_id"
  | "instrument_revision"
  | "work_id"
  | "created_at"
> & {
  supplier: DailySupplier;
  input_digest: string;
  start: string;
  end: string;
  bar_count: number;
};
export function marketSummary(s: MarketSnapshot): MarketSnapshotSummary {
  return {
    id: s.id,
    revision: 1,
    instrument_id: s.instrument_id,
    instrument_revision: s.instrument_revision,
    work_id: s.work_id,
    created_at: s.created_at,
    supplier: s.dataset.supplier,
    input_digest: s.dataset.input_digest,
    start: s.dataset.start,
    end: s.dataset.end,
    bar_count: s.dataset.bars.length,
  };
}
export interface MarketRepository {
  active(o: LightTickOwner, now: string): Promise<number>;
  get(o: LightTickOwner, id: string): Promise<MarketWork | undefined>;
  save(w: MarketWork, base: number): Promise<void>;
  count(o: LightTickOwner, since?: string): Promise<number>;
  recoverable(now: string, limit: number): Promise<MarketWork[]>;
  snapshot(o: LightTickOwner, id: string): Promise<MarketSnapshot | undefined>;
  publish(o: LightTickOwner, s: MarketSnapshot): Promise<void>;
  summaries(
    o: LightTickOwner,
    instrument?: string,
  ): Promise<MarketSnapshotSummary[]>;
  works(o: LightTickOwner): Promise<MarketWork[]>;
}
