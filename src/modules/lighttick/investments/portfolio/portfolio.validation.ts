import { keys, integer, object, text, fail } from "../../learning/native-learning.validation.ts";
import { investmentId, accountFields } from "../investment.service.ts";
import { decimalInput } from "../decimal.ts";
import { marketDate, shanghaiClock } from "../market/market.validation.ts";
import type { PortfolioInput, PortfolioFact } from "./portfolio.types.ts";
export function dateInput(v: unknown, now: Date, closed = false) { let d: string; try {
    d = marketDate(v);
}
catch {
    fail(422, "Valid YYYY-MM-DD date required.");
} const local = shanghaiClock(now); if (d > local.slice(0, 10) || closed && d === local.slice(0, 10) && local.slice(11, 16) < "15:30")
    fail(422, "Use an already completed date after Shanghai 15:30."); return d; }
export function portfolioInput(b: Record<string, unknown>, now: Date): PortfolioInput {
    const base_revision = integer(b.base_revision, 1, 2147483646);
    if (b.kind === "valuation") {
        keys(b, ["kind", "base_revision", "date", "sources"]);
        const sources = object(b.sources);
        if (Object.keys(sources).length > 100)
            fail(413, "At most 100 explicit sources allowed.");
        const selected = Object.fromEntries(Object.entries(sources).map(([k, v]) => [investmentId(k), investmentId(v)]));
        return { kind: "valuation", base_revision, date: dateInput(b.date, now, true), sources: selected };
    }
    if (b.kind === "baseline") {
        keys(b, ["kind", "base_revision", "reason", "baseline"]);
        const raw = object(b.baseline);
        keys(raw, ["name", "currency", "baseline_date", "opening_cash", "opening_positions"]);
        const { base_revision: _, ...fields } = { base_revision: 0, ...raw };
        const baseline = accountFields({ base_revision: 0, ...fields });
        dateInput(baseline.baseline_date, now);
        return { kind: "baseline", base_revision, reason: text(b.reason, 2000, true), baseline };
    }
    if (b.kind === "performance") {
        keys(b, ["kind", "base_revision", "start", "end"]);
        const start = dateInput(b.start, now, true), end = dateInput(b.end, now, true);
        if (start > end || Date.parse(end) - Date.parse(start) > 366 * 86400000)
            fail(422, "Performance interval must be ordered and at most 366 days.");
        return { kind: "performance", base_revision, start, end };
    }
    fail(422, "Select valuation, baseline or performance work.");
}
export function factFields(b: Record<string, unknown>, now: Date) {
    const base_revision = integer(b.base_revision, 0, 2147483646), base_account_revision = integer(b.base_account_revision, 1, 2147483646), instrument_id = investmentId(b.instrument_id), date = dateInput(b.date, now);
    if (b.kind === "fund_nav") {
        keys(b, ["base_revision", "base_account_revision", "instrument_id", "kind", "date", "nav", "source_label"]);
        if (base_revision !== 0)
            fail(422, "Confirmed NAV is immutable; append another source with a new identity.");
        return { base_revision, base_account_revision, fields: { kind: "fund_nav" as const, instrument_id, date, nav: decimalInput(b.nav, true), source_label: text(b.source_label, 200, true) } };
    }
    keys(b, ["base_revision", "base_account_revision", "instrument_id", "kind", "date", "notice_kind", "reason", "status", "resolution", "source_url"]);
    if (b.kind !== "notice" || !["corporate_action", "missing_fact", "cost_or_fee", "other"].includes(String(b.notice_kind)) || !["open", "resolved"].includes(String(b.status)))
        fail(422, "Explicit notice kind and status required.");
    const reason = text(b.reason, 2000, true), resolution = text(b.resolution, 4000, b.status === "resolved");
    let source_url: string | null = null;
    if (b.source_url !== null) {
        source_url = text(b.source_url, 2048, true);
        try {
            if (!["http:", "https:"].includes(new URL(source_url).protocol))
                throw Error();
        }
        catch {
            fail(422, "Notice source must be an HTTP(S) URL or explicit null.");
        }
    }
    return { base_revision, base_account_revision, fields: { kind: "notice" as const, instrument_id, date, notice_kind: b.notice_kind as Extract<PortfolioFact, {
                kind: "notice";
            }>["notice_kind"], reason, status: b.status as "open" | "resolved", resolution, source_url } };
}
