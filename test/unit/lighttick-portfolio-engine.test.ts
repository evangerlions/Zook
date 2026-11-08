import test from "node:test";
import { readFileSync } from "node:fs";
const golden = JSON.parse(readFileSync(new URL("../fixtures/lighttick/portfolio-golden.json", import.meta.url), "utf8"));
import assert from "node:assert/strict";
import { valuation, performance, financialDigest } from "../../src/modules/lighttick/investments/portfolio/portfolio.engine.ts";
import type { PortfolioContext, PortfolioFact, SavedPortfolio } from "../../src/modules/lighttick/investments/portfolio/portfolio.types.ts";
const iid = "inv-portfolio-symbol", aid = "inv-portfolio-account", now = "2026-11-08T04:00:00Z";
function context(): PortfolioContext { return { account: { id: aid, revision: 1, baseline_version: 1, name: "Synthetic", currency: "CNY", baseline_date: "2026-10-26", opening_cash: golden.baseline.opening_cash, opening_positions: [{ instrument_id: iid, quantity: golden.baseline.quantity, cost: golden.baseline.cost }], opening_instruments: [], archived: false, created_at: now, updated_at: now }, events: [], facts: [], instruments: [{ id: iid, revision: 1, code: "510000", market: "SSE", kind: "etf", name: "Synthetic ETF", archived: false, created_at: now, updated_at: now }], markets: [{ id: "inv-portfolio-source", revision: 1, instrument_id: iid, instrument_revision: 1, work_id: "inv-portfolio-source", created_at: now, dataset: { supplier: "csv", price_basis: "unadjusted", instrument_id: iid, bars: structuredClone(golden.prices.slice(0, 2)), input_digest: "a".repeat(64) } as any, indicators: {} as any }], valuations: [], captured_at: now, context_digest: "t" }; }
const input = (date: string, sources = {}) => ({ kind: "valuation" as const, base_revision: 1, date, sources });
function saved(id: string, c: PortfolioContext, date: string): SavedPortfolio { return { id, account_id: aid, work_id: id, kind: "valuation", request_key: "synthetic-value-adopt", created_at: now, output: valuation(c, input(date)) }; }
test("golden: cost is not market value; partial sale and net deposit yield exact profit 99", () => {
    const c = context();
    const start = saved("inv-start-value", c, "2026-10-26");
    assert.equal(start.output.kind === "valuation" && start.output.balance.equity, golden.expected.initial_equity);
    c.events = [{ id: "inv-portfolio-sale", account_id: aid, sequence: 2, created_at: now, input: { business_date: "2026-10-27", kind: "fill", fill: { instrument_id: iid, side: "sell", price: "11", quantity: "50", fee: "1", tax: "0" } } }, { id: "inv-portfolio-deposit", account_id: aid, sequence: 3, created_at: now, input: { business_date: "2026-10-27", kind: "cash", cash: { kind: "deposit", amount: "1000" } } }];
    const end = saved("inv-end-value", c, "2026-10-27");
    assert.equal(end.output.kind === "valuation" && end.output.balance.equity, golden.expected.final_equity);
    c.valuations = [start, end];
    const p = performance(c, { kind: "performance", base_revision: 1, start: "2026-10-26", end: "2026-10-27" });
    assert.equal(p.net_profit, golden.expected.net_profit);
    assert.equal(p.net_deposit, golden.expected.net_deposit);
    assert.equal(p.maximum_drawdown_pct, null);
    assert.equal(p.series[0].stale, false);
});
test("missing/conflicting/stale quotes and unknown calendar never fill zero or switch sources", () => {
    const c = context();
    c.markets = [];
    assert.equal(valuation(c, input("2026-10-26")).balance.equity, null);
    c.markets = context().markets;
    c.markets.push({ ...structuredClone(c.markets[0]), id: "inv-other-source" });
    assert.equal(valuation(c, input("2026-10-26")).quotes[0].status, "conflict");
    assert.equal(valuation(c, input("2026-10-26", { [iid]: c.markets[0].id })).balance.equity, "11000");
    assert.throws(() => valuation(c, input("2026-10-26", { [iid]: "inv-wrong-source" })), /source/i);
    assert.equal(valuation(c, input("2026-10-28")).quotes[0].status, "conflict");
    c.markets.pop();
    assert.equal(valuation(c, input("2026-10-28")).quotes[0].status, "stale");
    c.captured_at = "2027-01-06T08:00:00Z";
    assert.equal(valuation(c, input("2027-01-04")).balance.equity, null);
});
test("fund confirmed NAV and open reconciliation notices retain unknown assurances", () => {
    const c = context();
    c.instruments[0].kind = "fund";
    c.instruments[0].market = "FUND";
    c.markets = [];
    const nav: PortfolioFact = { id: "inv-confirmed-nav", revision: 1, account_id: aid, instrument_id: iid, kind: "fund_nav", nav: golden.fund_nav, date: "2026-10-26", source_label: "Synthetic published NAV", request_key: "synthetic-nav-fact", created_at: now, updated_at: now };
    c.facts = [nav];
    assert.equal(valuation(c, input("2026-10-26")).balance.equity, golden.expected.fund_equity);
    c.facts.push({ id: "inv-open-notice", account_id: aid, instrument_id: iid, revision: 1, kind: "notice", notice_kind: "corporate_action", date: "2026-10-27", request_key: "synthetic-notice-fact", reason: "Synthetic split not reconciled", status: "open", resolution: "", source_url: null, created_at: now, updated_at: now });
    assert.equal(valuation(c, input("2026-10-27")).balance.cash_verified, false);
    assert.equal(valuation(c, input("2026-10-26")).notices.length, 0);
});
test("historical staleness follows relevant facts, corrections and notices, not later-day deposits", () => {
    const c = context(), before = financialDigest(c, "2026-10-26");
    c.events.push({ id: "inv-later-deposit", sequence: 2, account_id: aid, created_at: now, input: { business_date: "2026-10-27", kind: "cash", cash: { kind: "deposit", amount: "1" } } });
    assert.equal(financialDigest(c, "2026-10-26"), before);
    c.account.baseline_version++;
    assert.notEqual(financialDigest(c, "2026-10-26"), before);
});
test("drawdown requires positive complete daily valuations and no external flows; fees remain unknown", () => {
    const c = context();
    c.markets[0].dataset.bars.push({ date: "2026-10-28", close: "9" } as any);
    c.valuations = [saved("inv-first", c, "2026-10-26"), saved("inv-second", c, "2026-10-27"), saved("inv-third", c, "2026-10-28")];
    const p = performance(c, { kind: "performance", base_revision: 1, start: "2026-10-26", end: "2026-10-28" });
    assert.equal(p.maximum_drawdown_pct, golden.expected.no_flow_drawdown_pct);
    c.valuations.splice(1, 1);
    assert.equal(performance(c, { kind: "performance", base_revision: 1, start: "2026-10-26", end: "2026-10-28" }).maximum_drawdown_pct, null);
});
test("weekend uses the last exchange session and missing fees never become confirmed cash or profit", () => {
    const c = context();
    c.markets[0].dataset.bars.push(golden.prices[3]);
    const weekend = valuation(c, input("2026-11-08"));
    assert.equal(weekend.quotes[0].expected_session, "2026-11-06");
    assert.equal(weekend.quotes[0].status, "available");
    c.events.push({ id: "inv-unknown-fee-fill", account_id: aid, sequence: 2, created_at: now, input: { business_date: "2026-10-27", kind: "fill", fill: { instrument_id: iid, side: "buy", quantity: "1", price: "11", fee: null, tax: "0" } } });
    const unknown = valuation(c, input("2026-10-27"));
    assert.equal(unknown.balance.equity, null);
    assert.equal(unknown.balance.cash_verified, false);
});
