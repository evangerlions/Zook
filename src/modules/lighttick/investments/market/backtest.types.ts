export interface BacktestConfig {
  initial_cash: string;
  quantity: string;
  strategy: "threshold" | "ma_cross";
  entry_above: string | null;
  exit_below: string | null;
  fast_window: number;
  slow_window: number;
  lot_size: number;
  price_tick: string;
  commission_rate: string;
  minimum_commission: string;
  sell_tax_rate: string;
  slippage_bps: string;
  max_participation: string;
  annual_periods: number;
  annual_risk_free: string;
}
export interface ExecutionBar {
  time: string;
  open_at: string;
  available_at: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume_shares: string;
  suspended: boolean;
  limit_up: string;
  limit_down: string;
  corporate_actions_known: boolean;
  adj_factor: string;
  split_ratio: string;
  cash_dividend: string;
}
export interface ExecutionSeries {
  price_basis: string;
  interval: "day" | "minute";
  bars: ExecutionBar[];
  sessions: string[] | Record<string, boolean>;
  expected_bar_times?: string[];
}
export interface EquityPoint {
  time: string;
  equity: string;
  cash: string;
  quantity: string;
  close: string;
  drawdown_pct?: string | null;
}
