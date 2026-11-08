import type { LightTickRepository } from "../../lighttick.repository.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import type { JobQueue } from "../../../../infrastructure/queue/job-queue.ts";
import { InvestmentService, investmentId } from "../investment.service.ts";
import { keys, integer, digest, fail, text } from "../../learning/native-learning.validation.ts";
import { portfolioSummary, type PortfolioWork, type PortfolioFact, type SavedPortfolio } from "./portfolio.types.ts";
import { portfolioInput, factFields } from "./portfolio.validation.ts";
import { portfolioContext } from "./portfolio.context.ts";
import { financialDigest } from "./portfolio.engine.ts";
export const PORTFOLIO_JOB = "lighttick.investment.portfolio";
export const PORTFOLIO_LIMITS = { works: 200, daily: 20, active: 1, attempts: 3, leaseMs: 60000, timeoutMs: 30000, facts: 500, saved: 500 };
export function portfolioPage<T extends {
    id: string;
}>(o: LightTickOwner, scope: string, rows: T[], cursor = "", limit = 20) {
    integer(limit, 1, 100);
    const ordered = [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), revision = digest(ordered);
    let after = "";
    if (cursor)
        try {
            if (cursor.length > 2048)
                throw Error();
            const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
            if (c.owner !== digest(o) || c.scope !== scope || c.revision !== revision || typeof c.after !== "string")
                throw Error();
            after = c.after;
        }
        catch {
            fail(409, "Portfolio cursor expired; rebuild read pages and retain local drafts and original requests.");
        }
    const page = ordered.filter(r => r.id > after);
    return { items: page.slice(0, limit), revision, next_cursor: page.length > limit ? Buffer.from(JSON.stringify({ owner: digest(o), scope, revision, after: page[limit - 1].id })).toString("base64url") : null };
}
export class PortfolioService extends InvestmentService {
    constructor(repo: LightTickRepository, readonly queue: JobQueue, authorize: () => Promise<void> = async () => { }, clock = () => new Date()) { super(repo, authorize, clock); }
    get store() { return this.repo.investments.portfolio; }
    view(w: PortfolioWork) { return { ...portfolioSummary(w), output: w.output }; }
    async account(o: LightTickOwner, id: string, base?: number) { investmentId(id); const a = await this.repo.investments.account(o, id); if (!a)
        fail(404, "Portfolio account not found."); if (base !== undefined && (a.archived || a.revision !== base))
        fail(409, "Account changed; compare before a new command."); return a; }
    async writeFact(o: LightTickOwner, account: string, id: string, b: Record<string, unknown>, key: string) {
        investmentId(account);
        investmentId(id);
        const { base_revision: base, base_account_revision, fields } = factFields(b, this.clock());
        return this.command(o, key, "investment_portfolio_fact", account + "/" + id, "write", b, async (now) => {
            const a = await this.account(o, account, base_account_revision), prior = await this.store.fact(o, id), instrument = await this.repo.investments.instrument(o, fields.instrument_id);
            if (!instrument || instrument.archived)
                fail(409, "Portfolio instrument is unavailable.");
            if (fields.kind === "fund_nav" && instrument.kind !== "fund")
                fail(422, "Confirmed NAV requires a fund instrument.");
            if (prior && (prior.account_id !== account || prior.kind !== fields.kind || prior.instrument_id !== fields.instrument_id))
                fail(409, "Fact identity belongs to a different resource.");
            if ((prior?.revision ?? 0) !== base || prior?.kind === "fund_nav")
                fail(409, "Fact changed or NAV is immutable.");
            const rows = await this.store.facts(o, account);
            if (!prior && rows.length >= PORTFOLIO_LIMITS.facts || base >= 500)
                fail(413, "Portfolio fact/history capacity exceeded.");
            const row: PortfolioFact = { ...fields, id, account_id: account, revision: base + 1, request_key: key, created_at: prior?.created_at ?? now, updated_at: now };
            await this.store.saveFact(o, row, base);
            await this.repo.investments.saveAccount(o, { ...a, revision: a.revision + 1, updated_at: now }, a.revision);
            return row;
        });
    }
    async create(o: LightTickOwner, account: string, b: Record<string, unknown>, key: string) {
        investmentId(account);
        const input = portfolioInput(b, this.clock()), id = "inv-" + digest([o, account, key, "portfolio"]).slice(0, 40);
        const result = await this.command(o, key, "investment_portfolio_work", account + "/" + id, "create", b, async (now) => {
            if (await this.store.count(o) >= PORTFOLIO_LIMITS.works || await this.store.count(o, now.slice(0, 10) + "T00:00:00.000Z") >= PORTFOLIO_LIMITS.daily)
                fail(429, "Portfolio work budget exhausted.");
            const context = await portfolioContext(this.repo, o, account, input, now), w: PortfolioWork = { ...o, id, account_id: account, revision: 1, request_key: key, command_keys: [key], input, context, status: "queued", attempt: 0, fence: null, lease_until: null, error_code: null, output: null, created_at: now, updated_at: now };
            await this.store.saveWork(w, 0);
            return this.view(w);
        });
        await this.dispatch(o, result.id);
        return this.readWork(o, account, result.id);
    }
    async dispatch(o: LightTickOwner, id: string) { const w = await this.store.work(o, id); if (!w || w.status !== "queued" && !(w.status === "running" && w.lease_until! <= this.clock().toISOString()))
        return; try {
        await this.queue.add(PORTFOLIO_JOB, { app_id: o.appId, user_id: o.userId, work_id: id }, { attempts: 3, backoffMs: 2000, jobId: "portfolio-" + digest([o, id, w.revision]).slice(0, 40) });
    }
    catch { /* Original durable work is recovered by the existing worker. */ } }
    async original(w: PortfolioWork) { const op = await this.repo.getOperation(w, w.request_key); if (!op || op.entityType !== "investment_portfolio_work" || op.entityId !== w.account_id + "/" + w.id || op.action !== "create")
        throw Error("Portfolio original receipt unavailable."); }
    async readWork(o: LightTickOwner, account: string, id: string) { investmentId(id); return this.repo.transaction(o, async () => { await this.authorize(); await this.account(o, account); const w = await this.store.work(o, id); if (!w || w.account_id !== account)
        fail(404, "Portfolio work not found."); return this.view(w); }); }
    async cancel(o: LightTickOwner, account: string, id: string, b: Record<string, unknown>, key: string) { investmentId(id); keys(b, ["base_revision"]); const base = integer(b.base_revision, 1, 2147483646); return this.command(o, key, "investment_portfolio_work", account + "/" + id, "cancel", b, async (now) => { await this.account(o, account); const w = await this.store.work(o, id); if (!w || w.account_id !== account)
        fail(404, "Portfolio work not found."); if (w.revision !== base || !["queued", "running"].includes(w.status))
        fail(409, "Portfolio work changed or is terminal."); await this.original(w); const next: PortfolioWork = { ...w, revision: base + 1, status: "cancelled", fence: null, lease_until: null, error_code: "CANCELLED", command_keys: [...w.command_keys, key], updated_at: now }; await this.store.saveWork(next, base); return this.view(next); }); }
    async adopt(o: LightTickOwner, account: string, id: string, b: Record<string, unknown>, key: string) {
        investmentId(id);
        keys(b, ["base_revision", "preview_digest"]);
        const base = integer(b.base_revision, 1, 2147483646), hash = text(b.preview_digest, 64, true);
        if (!/^[a-f0-9]{64}$/.test(hash))
            fail(422, "Retain the exact preview digest.");
        return this.command(o, key, "investment_portfolio_adopt", account + "/" + id, "adopt", b, async (now) => {
            const a = await this.account(o, account, base), w = await this.store.work(o, id);
            if (!w || w.account_id !== account)
                fail(404, "Portfolio preview not found.");
            if (w.status !== "succeeded" || !w.output || w.output.kind === "performance" || w.output.preview_digest !== hash || w.input.base_revision !== base)
                fail(409, "Review a successful matching preview before adoption.");
            await this.original(w);
            const current = await portfolioContext(this.repo, o, account, w.input, now);
            if (current.context_digest !== w.context.context_digest)
                fail(409, "Preview inputs changed; retain the original command and review a new preview.");
            const rows = await this.store.saved(o, account);
            if (rows.length >= PORTFOLIO_LIMITS.saved)
                fail(413, "Portfolio adoption capacity exceeded.");
            const duplicate = rows.find(r => r.work_id === id);
            if (duplicate)
                fail(409, "Preview already adopted; replay the original adoption request.");
            if (w.output.kind === "baseline")
                await this.repo.investments.saveAccount(o, { ...a, ...w.output.after, revision: a.revision + 1, updated_at: now }, a.revision, a.baseline_version);
            const saved: SavedPortfolio = { id: "inv-" + digest([o, id, "adopt"]).slice(0, 40), account_id: account, work_id: id, request_key: key, kind: w.output.kind, created_at: now, output: w.output };
            await this.store.publish(o, saved);
            return saved;
        });
    }
    async listPortfolio(o: LightTickOwner, account: string, kind: "facts" | "work" | "baselines", cursor = "", limit = 20) { return this.repo.transaction(o, async () => { await this.authorize(); await this.account(o, account); if (kind === "facts")
        return portfolioPage(o, account + kind, await this.store.facts(o, account), cursor, limit); if (kind === "work")
        return portfolioPage(o, account + kind, await this.store.summaries(o, account), cursor, limit); return portfolioPage(o, account + kind, (await this.repo.investments.baselines(o, account)).map(b => ({ ...b, id: String(b.baseline_version).padStart(10, "0") })), cursor, limit); }); }
    async history(o: LightTickOwner, account: string, id: string, cursor = "", limit = 20) { investmentId(id); return this.repo.transaction(o, async () => { await this.authorize(); await this.account(o, account); const f = await this.store.fact(o, id); if (!f || f.account_id !== account)
        fail(404, "Portfolio fact not found."); return portfolioPage(o, account + id, (await this.store.history(o, id)).map(v => ({ ...v, id: String(v.revision).padStart(10, "0"), fact_id: v.id })), cursor, limit); }); }
    async readFact(o: LightTickOwner, account: string, id: string) { investmentId(id); return this.repo.transaction(o, async () => { await this.authorize(); await this.account(o, account); const f = await this.store.fact(o, id); if (!f || f.account_id !== account)
        fail(404, "Portfolio fact not found."); return f; }); }
    async valuations(o: LightTickOwner, account: string, cursor = "", limit = 20, id?: string) { return this.repo.transaction(o, async () => { await this.authorize(); const a = await this.account(o, account), context = { account: a, events: await this.repo.investments.ledger.events(o, account), facts: await this.store.facts(o, account) }; const rows = (await this.store.saved(o, account)).filter(v => v.kind === "valuation").map(v => ({ ...v, stale: v.output.kind === "valuation" && v.output.ledger_digest !== financialDigest(context as any, v.output.date) })); if (id) {
        const v = rows.find(v => v.id === id);
        if (!v)
            fail(404, "Valuation not found.");
        return v;
    } return portfolioPage(o, account + "valuations", rows, cursor, limit); }); }
}
