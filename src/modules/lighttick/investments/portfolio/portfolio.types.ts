import type { LightTickOwner } from "../../lighttick.types.ts";
import type { InvestmentAccount, InvestmentInstrument } from "../investment.types.ts";
import type { LedgerEvent, LedgerReport } from "../ledger.types.ts";
import type { MarketSnapshot } from "../market/market-work.types.ts";
import type { reconcile } from "../accounting.ts";
export type Baseline = Pick<InvestmentAccount, "name" | "currency" | "baseline_date" | "opening_cash" | "opening_positions" | "baseline_version">;
export type PortfolioFact = {
    id: string;
    account_id: string;
    revision: number;
    instrument_id: string;
    request_key: string;
    created_at: string;
    updated_at: string;
} & ({
    kind: "fund_nav";
    nav: string;
    date: string;
    source_label: string;
} | {
    kind: "notice";
    notice_kind: "corporate_action" | "missing_fact" | "cost_or_fee" | "other";
    date: string;
    reason: string;
    status: "open" | "resolved";
    resolution: string;
    source_url: string | null;
});
export type PortfolioInput = {
    base_revision: number;
} & ({
    kind: "valuation";
    date: string;
    sources: Record<string, string>;
} | {
    kind: "baseline";
    reason: string;
    baseline: Omit<Baseline, "baseline_version">;
} | {
    kind: "performance";
    start: string;
    end: string;
});
export interface PortfolioContext {
    account: InvestmentAccount;
    events: LedgerEvent[];
    facts: PortfolioFact[];
    instruments: InvestmentInstrument[];
    markets: MarketSnapshot[];
    valuations: SavedPortfolio[];
    captured_at: string;
    context_digest: string;
}
export interface QuoteCandidate {
    id: string;
    revision: number;
    digest: string;
    kind: "market" | "fund_nav";
    price: string;
    date: string;
    source: string;
    price_basis: string;
}
export interface ValuationQuote {
    instrument_id: string;
    expected_session: string | null;
    status: "available" | "missing" | "conflict" | "stale" | "calendar_unknown";
    selected: QuoteCandidate | null;
    candidates: QuoteCandidate[];
}
export type PortfolioBalance = Omit<ReturnType<typeof reconcile>, "realized" | "positions"> & {
    realized: string | null;
    positions: (ReturnType<typeof reconcile>["positions"][number] & {
        quantity_verified: boolean;
    })[];
};
export interface ValuationResult {
    kind: "valuation";
    date: string;
    account_id: string;
    account_revision: number;
    baseline_version: number;
    algorithm_version: string;
    method: "current_audited_facts_by_economic_date";
    ledger_digest: string;
    input_digest: string;
    quotes: ValuationQuote[];
    coverage: {
        required: number;
        available: number;
        missing: number;
    };
    holdings_value: string | null;
    balance: PortfolioBalance;
    notices: PortfolioFact[];
    calendar_version: string;
    preview_digest: string;
}
export interface BaselineResult {
    kind: "baseline";
    reason: string;
    before: Baseline;
    after: Baseline;
    ledger_report: LedgerReport;
    input_digest: string;
    preview_digest: string;
}
export interface PerformanceResult {
    kind: "performance";
    start: string;
    end: string;
    algorithm_version: string;
    input_digest: string;
    net_profit: string | null;
    net_deposit: string;
    cash_components: Record<string, string>;
    maximum_drawdown_pct: string | null;
    twr: null;
    xirr: null;
    series: {
        id: string;
        date: string;
        stale: boolean;
        equity: string | null;
        ledger_digest: string;
    }[];
    limitations: string[];
}
export type PortfolioResult = ValuationResult | BaselineResult | PerformanceResult;
export interface PortfolioWork extends LightTickOwner {
    id: string;
    account_id: string;
    revision: number;
    request_key: string;
    command_keys: string[];
    input: PortfolioInput;
    context: PortfolioContext;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    attempt: number;
    fence: string | null;
    lease_until: string | null;
    error_code: string | null;
    output: PortfolioResult | null;
    created_at: string;
    updated_at: string;
}
export interface SavedPortfolio {
    id: string;
    account_id: string;
    work_id: string;
    request_key: string;
    kind: "valuation" | "baseline";
    created_at: string;
    output: ValuationResult | BaselineResult;
}
export function portfolioSummary(w: PortfolioWork) { const { appId, userId, context, output, fence, lease_until, request_key, command_keys, ...v } = w; return { ...v, has_output: output !== null }; }
export type PortfolioSummary = ReturnType<typeof portfolioSummary>;
export interface PortfolioRepository {
    fact(o: LightTickOwner, id: string, revision?: number): Promise<PortfolioFact | undefined>;
    facts(o: LightTickOwner, account: string): Promise<PortfolioFact[]>;
    history(o: LightTickOwner, id: string): Promise<PortfolioFact[]>;
    saveFact(o: LightTickOwner, f: PortfolioFact, base: number): Promise<void>;
    work(o: LightTickOwner, id: string): Promise<PortfolioWork | undefined>;
    summaries(o: LightTickOwner, account?: string): Promise<PortfolioSummary[]>;
    count(o: LightTickOwner, since?: string): Promise<number>;
    active(o: LightTickOwner, now: string): Promise<number>;
    saveWork(w: PortfolioWork, base: number): Promise<void>;
    recoverable(now: string, limit: number): Promise<PortfolioWork[]>;
    saved(o: LightTickOwner, account: string): Promise<SavedPortfolio[]>;
    publish(o: LightTickOwner, s: SavedPortfolio): Promise<void>;
    baselineReport(o: LightTickOwner, account: string): Promise<LedgerReport | null>;
}
