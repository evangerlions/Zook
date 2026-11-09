import type { InvestmentInstrument } from "../investment.types.ts";
export type DailySupplier = "csv" | "tushare" | "eastmoney" | "tencent";
export interface DailyBar {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume_shares: string;
  amount_cny: string;
  turnover_rate_pct: string | null;
}
export interface DailyRequest {
  instrument: InvestmentInstrument;
  start: string;
  end: string;
  csv?: string;
  declared_source?: string;
  volume_unit?: "shares" | "lots100";
  amount_unit?: "CNY" | "thousand_CNY" | "ten_thousand_CNY";
}
export interface DailyDataset {
  supplier: DailySupplier;
  adapter_version: string;
  instrument_id: string;
  code: string;
  market: string;
  kind: string;
  start: string;
  end: string;
  price_basis: "unadjusted";
  realtime: false;
  retrieved_at: string;
  available_at: string;
  source_units: { volume: string; amount: string };
  calendar: Record<string, unknown>;
  missing_sessions: string[] | null;
  bars: DailyBar[];
  input_digest: string;
  limitations: string[];
}
export interface MarketProviderPolicy {
  enabled: boolean;
  revision: string;
  tushare_token?: string;
}
export type MarketPolicyResolver = (
  supplier: DailySupplier,
) => Promise<MarketProviderPolicy>;
