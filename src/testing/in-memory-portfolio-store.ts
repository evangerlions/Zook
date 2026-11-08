import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { PortfolioRepository, PortfolioFact, PortfolioWork, SavedPortfolio } from "../modules/lighttick/investments/portfolio/portfolio.types.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";
import { portfolioSummary } from "../modules/lighttick/investments/portfolio/portfolio.types.ts";
const key = (o: LightTickOwner, id: string) => JSON.stringify([o.appId, o.userId, id]), prefix = (o: LightTickOwner) => JSON.stringify([o.appId, o.userId]).slice(0, -1) + ",";
export class InMemoryPortfolioStore implements PortfolioRepository {
    private entries = new Map<string, PortfolioFact[]>();
    private runs = new Map<string, PortfolioWork>();
    private reports = new Map<string, SavedPortfolio>();
    async fact(o: LightTickOwner, id: string, revision?: number) { const rows = this.entries.get(key(o, id)); return structuredClone(revision === undefined ? rows?.at(-1) : rows?.find(f => f.revision === revision)); }
    async facts(o: LightTickOwner, account: string) { return structuredClone([...this.entries].filter(([k]) => k.startsWith(prefix(o))).map(([, v]) => v.at(-1)!).filter(f => f.account_id === account).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 501)); }
    async history(o: LightTickOwner, id: string) { return structuredClone([...(this.entries.get(key(o, id)) ?? [])].reverse()); }
    async saveFact(o: LightTickOwner, f: PortfolioFact, base: number) { const k = key(o, f.id), rows = this.entries.get(k) ?? []; if ((rows.at(-1)?.revision ?? 0) !== base)
        fail(409, "Portfolio fact changed."); this.entries.set(k, [...rows, structuredClone(f)]); }
    async work(o: LightTickOwner, id: string) { return structuredClone(this.runs.get(key(o, id))); }
    async works(o: LightTickOwner, account?: string) { return structuredClone([...this.runs].filter(([k]) => k.startsWith(prefix(o))).map(([, v]) => v).filter(w => !account || w.account_id === account).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 201)); }
    async summaries(o: LightTickOwner, account?: string) { return (await this.works(o, account)).map(portfolioSummary); }
    async count(o: LightTickOwner, since?: string) { return (await this.works(o)).filter(w => !since || w.created_at >= since).length; }
    async active(o: LightTickOwner, now: string) { return (await this.works(o)).filter(w => w.status === "running" && w.lease_until! > now).length; }
    async saveWork(w: PortfolioWork, base: number) { const k = key(w, w.id); if ((this.runs.get(k)?.revision ?? 0) !== base)
        fail(409, "Portfolio work changed."); this.runs.set(k, structuredClone(w)); }
    async recoverable(now: string, limit: number) { return structuredClone([...this.runs.values()].filter(w => w.status === "queued" || w.status === "running" && w.lease_until! <= now).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).slice(0, limit)); }
    async saved(o: LightTickOwner, account: string) { return structuredClone([...this.reports].filter(([k]) => k.startsWith(prefix(o))).map(([, v]) => v).filter(v => v.account_id === account).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 501)); }
    async publish(o: LightTickOwner, s: SavedPortfolio) { const k = key(o, s.id); if (this.reports.has(k))
        fail(409, "Portfolio preview already adopted."); this.reports.set(k, structuredClone(s)); }
    async baselineReport(o: LightTickOwner, account: string) { return (await this.saved(o, account)).flatMap(s => s.output.kind === "baseline" ? [s.output.ledger_report] : []).sort((a, b) => b.account_revision - a.account_revision)[0] ?? null; }
    snapshot() { return structuredClone({ entries: [...this.entries], runs: [...this.runs], reports: [...this.reports] }); }
    restore(v: ReturnType<InMemoryPortfolioStore["snapshot"]>) { this.entries = new Map(v.entries); this.runs = new Map(v.runs); this.reports = new Map(v.reports); }
    deleteOwner(o: LightTickOwner) { for (const m of [this.entries, this.runs, this.reports])
        for (const k of m.keys())
            if (k.startsWith(prefix(o)))
                m.delete(k); }
}
