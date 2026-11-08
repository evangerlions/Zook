import { reconcile } from "../accounting.ts";
import { LedgerDecimal as D, decimalString as str } from "../decimal.ts";
import { projectLedger } from "../ledger.projection.ts";
import { referenceCalendar, CALENDAR_VERSION } from "../market/market.calendar.ts";
import { digest, fail } from "../../learning/native-learning.validation.ts";
import type { PortfolioContext, PortfolioInput, PortfolioResult, ValuationResult, QuoteCandidate, PerformanceResult, PortfolioBalance } from "./portfolio.types.ts";
import { calculateLedger } from "../ledger.runner.ts";
export const PORTFOLIO_VERSION = "audited-economic-date-decimal60-v1";
export function financialDigest(c: Pick<PortfolioContext,"account"|"events"|"facts">, date: string, projected = projectLedger(c.events).active) {
    const a = c.account;
    return digest({ baseline: { version: a.baseline_version, date: a.baseline_date, cash: a.opening_cash, positions: a.opening_positions },
        events: projected.filter(e => e.input.business_date <= date).map(e => ({ id: e.id, sequence: e.sequence, input: e.input })),
        notices: c.facts.filter(f => f.kind === "notice" && f.date <= date) });
}
function calendar(c: PortfolioContext, market: string, start: string, end: string) { return referenceCalendar(market, start, end, new Date(c.captured_at)); }
export function valuation(c: PortfolioContext, b: Extract<PortfolioInput, {
    kind: "valuation";
}>): ValuationResult {
    if (b.date < c.account.baseline_date)
        fail(422, "Valuation predates the baseline.");
    const events = projectLedger(c.events).active.filter(e => e.input.business_date <= b.date), cash = events.flatMap(e => e.input.kind === "cash" ? [e.input.cash] : []), fills = events.flatMap(e => e.input.kind === "fill" ? [e.input.fill] : []);
    const raw = reconcile(c.account.opening_cash, cash, fills, c.account.opening_positions, {}), held = raw.positions.filter(p => new D(p.quantity).gt(0));
    if (held.length > 100)
        fail(413, "At most 100 held instruments can be valued in one portfolio snapshot.");
    if (Object.keys(b.sources).some(id => !held.some(p => p.instrument_id === id)))
        fail(422, "Source selection is outside held instruments.");
    const marks: Record<string, string> = {}, quotes: ValuationResult["quotes"] = [];
    const start = new Date(Date.parse(b.date) - 31 * 86400000).toISOString().slice(0, 10);
    for (const p of held) {
        const i = c.instruments.find(i => i.id === p.instrument_id);
        if (!i)
            fail(422, "Held instrument is unavailable.");
        const cal = calendar(c, i.kind === "fund" ? "SSE" : i.market, start < "2026-01-01" && b.date >= "2026-01-01" ? "2026-01-01" : start, b.date), expected = Object.keys(cal.sessions).filter(d => cal.sessions[d]).sort().at(-1) ?? null;
        let candidates: QuoteCandidate[] = [];
        if (i.kind === "fund")
            candidates = c.facts.filter(f => f.kind === "fund_nav" && f.instrument_id === i.id && f.date <= b.date).map(f => ({ id: f.id, revision: f.revision, digest: digest(f), kind: "fund_nav", price: f.kind === "fund_nav" ? f.nav : "", date: f.date, source: f.kind === "fund_nav" ? f.source_label : "", price_basis: "confirmed_nav" }));
        else
            for (const s of c.markets.filter(s => s.instrument_id === i.id && s.dataset.price_basis === "unadjusted")) {
                const bar = s.dataset.bars.filter(bar => bar.date <= b.date).sort((x, y) => x.date.localeCompare(y.date)).at(-1);
                if (bar)
                    candidates.push({ id: s.id, revision: 1, digest: digest(s), kind: "market", price: bar.close, date: bar.date, source: s.dataset.supplier, price_basis: "unadjusted" });
            }
        const latest = candidates.map(q => q.date).sort().at(-1);
        candidates = candidates.filter(q => q.date === latest).sort((x, y) => x.id.localeCompare(y.id));
        let selected = candidates.find(q => q.id === b.sources[i.id]) ?? null;
        if (b.sources[i.id] && !selected)
            fail(409, "Selected source is not available for this instrument/date; review a new preview.");
        if (!selected && candidates.length === 1)
            selected = candidates[0];
        const status = !candidates.length ? "missing" : !selected ? "conflict" : !expected || cal.status !== "available" ? "calendar_unknown" : selected.date !== expected ? "stale" : "available";
        if (status === "available")
            marks[i.id] = selected!.price;
        quotes.push({ instrument_id: i.id, expected_session: expected, status, selected, candidates });
    }
    const notices = c.facts.filter(f => f.kind === "notice" && f.status === "open" && f.date <= b.date), computed = reconcile(c.account.opening_cash, cash, fills, c.account.opening_positions, marks);
    const balance: PortfolioBalance = { ...computed, positions: computed.positions.map(p => ({ ...p, quantity_verified: !notices.some(n => n.instrument_id === p.instrument_id) })) };
    if (notices.length) {
        balance.realized = null;
        balance.net_realized = null;
        balance.equity = null;
        balance.cash_verified = false;
        balance.warnings.push("存在账实差异或公司行动待核对，所录数量、现金和净结果暂不可确认。");
        for (const p of balance.positions)
            if (notices.some(n => n.instrument_id === p.instrument_id)) {
                p.cost = null;
                p.realized = null;
                p.unrealized = null;
            }
    }
    const values = balance.positions.map(p => p.market_value), holdings = values.every(v => v !== null) ? str(values.reduce((n, v) => n.plus(v!), new D(0))) : null;
    const body = { kind: "valuation" as const, date: b.date, account_id: c.account.id, account_revision: b.base_revision, baseline_version: c.account.baseline_version, algorithm_version: PORTFOLIO_VERSION, method: "current_audited_facts_by_economic_date" as const, ledger_digest: financialDigest(c, b.date), input_digest: digest({ context: c, input: b, algorithm: PORTFOLIO_VERSION }), quotes, coverage: { required: held.length, available: Object.keys(marks).length, missing: held.length - Object.keys(marks).length }, holdings_value: holdings, balance, notices, calendar_version: CALENDAR_VERSION };
    return { ...body, preview_digest: digest(body) };
}
export function performance(c: PortfolioContext, b: Extract<PortfolioInput, {
    kind: "performance";
}>): PerformanceResult {
    const rows = c.valuations.filter(v => v.kind === "valuation" && v.output.kind === "valuation" && v.output.date >= b.start && v.output.date <= b.end).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)), byDate = new Map<string, PerformanceResult["series"][number]>();
    for (const v of rows)
        if (v.output.kind === "valuation" && !byDate.has(v.output.date))
            byDate.set(v.output.date, { id: v.id, date: v.output.date, stale: financialDigest(c, v.output.date) !== v.output.ledger_digest, equity: v.output.balance.equity, ledger_digest: v.output.ledger_digest });
    const components: Record<string, InstanceType<typeof D>> = Object.fromEntries(["deposit", "withdrawal", "dividend", "interest", "fee"].map(k => [k, new D(0)]));
    let external = false;
    for (const e of projectLedger(c.events).active)
        if (e.input.kind === "cash" && e.input.business_date > b.start && e.input.business_date <= b.end) {
            const f = e.input.cash;
            if (f.kind in components)
                components[f.kind] = components[f.kind].plus(f.amount);
            if (["deposit", "withdrawal"].includes(f.kind))
                external = true;
        }
    const net = components.deposit.minus(components.withdrawal), first = byDate.get(b.start), last = byDate.get(b.end), valid = (v: typeof first) => !!v && !v.stale && v.equity !== null;
    const profit = valid(first) && valid(last) ? new D(last!.equity!).minus(first!.equity!).minus(net) : null;
    const cal = calendar(c, "SSE", b.start, b.end), required = [...new Set([b.start, b.end, ...Object.keys(cal.sessions).filter(d => cal.sessions[d])])].sort();
    let drawdown: InstanceType<typeof D> | null = null;
    if (cal.status === "available" && !external && required.every(d => valid(byDate.get(d)) && new D(byDate.get(d)!.equity!).gt(0))) {
        let peak = new D(byDate.get(required[0])!.equity!);
        drawdown = new D(0);
        for (const d of required) {
            const value = new D(byDate.get(d)!.equity!);
            peak = D.max(peak, value);
            drawdown = D.max(drawdown, peak.minus(value).div(peak).mul(100));
        }
    }
    return { kind: "performance", start: b.start, end: b.end, algorithm_version: PORTFOLIO_VERSION, input_digest: digest({ context: c, input: b, algorithm: PORTFOLIO_VERSION }), net_profit: str(profit), net_deposit: str(net), cash_components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, str(v)])), maximum_drawdown_pct: str(drawdown), twr: null, xirr: null, series: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), limitations: ["收益金额=期末资产−期初资产−期间净入金，并非收益率。", "缺估值、账本/通知已更正或费用未齐时保持未知。", "回撤仅适用于无外部资金流、完整交易日且正资产的区间；TWR/XIRR未提供。"] };
}
export function calculatePortfolio(c: PortfolioContext, b: PortfolioInput): PortfolioResult {
    if (b.kind === "valuation")
        return valuation(c, b);
    if (b.kind === "performance")
        return performance(c, b);
    if (c.events.some(e => e.input.business_date < b.baseline.baseline_date || (e.input.kind === "correction" && e.input.correction.replacement && e.input.correction.replacement.business_date < b.baseline.baseline_date)))
        fail(422, "Existing facts predate the proposed baseline.");
    const after = { ...b.baseline, baseline_version: c.account.baseline_version + 1 }, ledger_report = calculateLedger({ ...c.account, ...after }, c.events), before = { name: c.account.name, currency: c.account.currency, baseline_date: c.account.baseline_date, opening_cash: c.account.opening_cash, opening_positions: c.account.opening_positions, baseline_version: c.account.baseline_version };
    const body = { kind: "baseline" as const, reason: b.reason, before, after, ledger_report, input_digest: digest({ context: c, input: b, algorithm: PORTFOLIO_VERSION }) };
    return { ...body, preview_digest: digest(body) };
}
