import {freezePortfolioCalendars} from "./portfolio.calendar.ts";
import type { LightTickRepository } from "../../lighttick.repository.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import type { PortfolioInput, PortfolioContext } from "./portfolio.types.ts";
import { digest, fail } from "../../learning/native-learning.validation.ts";
import { PORTFOLIO_VERSION } from "./portfolio.engine.ts";
/** Caller owns the repository owner snapshot. Only freeze reads here; financial computation belongs to worker. */
export async function portfolioContext(repo: LightTickRepository, o: LightTickOwner, id: string, input: PortfolioInput, now: string): Promise<PortfolioContext> {
    const account = await repo.investments.account(o, id);
    if (!account)
        fail(404, "Portfolio account not found.");
    if (account.archived || account.revision !== input.base_revision)
        fail(409, "Portfolio account context changed; compare before creating a new command.");
    const events = await repo.investments.ledger.events(o, id), facts = await repo.investments.portfolio.facts(o, id), ids = new Set(account.opening_positions.map(p => p.instrument_id));
    if (events.length > 10000 || facts.length > 500)
        fail(413, "Portfolio facts exceed capacity.");
    for (const e of events) {
        const f = e.input.kind === "correction" ? e.input.correction.replacement : e.input;
        if (f?.kind === "fill")
            ids.add(f.fill.instrument_id);
    }
    if (input.kind === "baseline")
        for (const p of input.baseline.opening_positions)
            ids.add(p.instrument_id);
    const instruments = [];
    for (const id of [...ids].sort()) {
        const i = await repo.investments.instrument(o, id);
        if (!i || i.archived)
            fail(409, "Referenced portfolio instrument is unavailable.");
        instruments.push(i);
    }
    const markets = [], summaries = input.kind === "valuation" ? (await repo.investments.market.summaries(o)).filter(s => ids.has(s.instrument_id) && s.start <= input.date) : [];
    if (summaries.length > 100)
        fail(413, "Relevant market source catalog exceeds capacity.");
    for (const s of summaries) {
        const snapshot = await repo.investments.market.snapshot(o, s.id);
        if (!snapshot)
            fail(409, "Frozen market source disappeared.");
        markets.push(snapshot);
    }
    const valuations = input.kind === "performance" ? await repo.investments.portfolio.saved(o, id) : [];
    if (valuations.length > 500)
        fail(413, "Portfolio report catalog exceeds capacity.");
    const calendars=freezePortfolioCalendars(input,new Date(now));
    const context_digest = digest({ account, events, facts, instruments, summaries, valuations,calendars, algorithm: PORTFOLIO_VERSION });
    const c = { account, events, facts, instruments, markets, valuations,calendars,algorithm_version:PORTFOLIO_VERSION, captured_at: now, context_digest };
    if (Buffer.byteLength(JSON.stringify(c)) > 2 * 1024 * 1024)
        fail(413, "Frozen portfolio input exceeds 2 MiB; narrow the source catalog.");
    return c;
}
