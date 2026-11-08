import { randomUUID } from "node:crypto";
import type { LightTickOwner } from "../../lighttick.types.ts";
import type { PortfolioWork, PortfolioResult } from "./portfolio.types.ts";
import { PortfolioService, PORTFOLIO_LIMITS } from "./portfolio.service.ts";
import { portfolioContext } from "./portfolio.context.ts";
import { computePortfolio } from "./portfolio.compute.ts";
export class PortfolioRunner {
    constructor(readonly service: PortfolioService, readonly authorizeOwner: (o: LightTickOwner) => Promise<void> = async () => { }, readonly compute = computePortfolio) { }
    get repo() { return this.service.repo; }
    get store() { return this.service.store; }
    get now() { return this.service.clock().toISOString(); }
    async recover() { const rows = await this.store.recoverable(this.now, 100); for (const w of rows)
        await this.service.dispatch(w, w.id); return rows.length; }
    async valid(w: PortfolioWork) { await this.authorizeOwner(w); await this.service.original(w); const c = await portfolioContext(this.repo, w, w.account_id, w.input, this.now); if (c.context_digest !== w.context.context_digest)
        throw Error("PORTFOLIO_CONTEXT_CHANGED"); }
    async failed(w: PortfolioWork, error_code: string) { const next: PortfolioWork = { ...w, revision: w.revision + 1, status: "failed", fence: null, lease_until: null, error_code, updated_at: this.now }; await this.store.saveWork(next, w.revision); return next; }
    async execute(o: LightTickOwner, id: string) {
        const snapshot = await this.repo.transaction(o, async () => {
            const w = await this.store.work(o, id);
            if (!w || !["queued", "running"].includes(w.status) || w.status === "running" && w.lease_until! > this.now)
                return;
            if (await this.store.active(o, this.now) >= PORTFOLIO_LIMITS.active)
                return;
            if (w.attempt >= PORTFOLIO_LIMITS.attempts) {
                await this.failed(w, "ATTEMPTS_EXHAUSTED");
                return;
            }
            try {
                await this.valid(w);
            }
            catch {
                await this.failed(w, "PORTFOLIO_CONTEXT_CHANGED");
                return;
            }
            const next: PortfolioWork = { ...w, revision: w.revision + 1, status: "running", attempt: w.attempt + 1, fence: randomUUID(), lease_until: new Date(this.service.clock().getTime() + PORTFOLIO_LIMITS.leaseMs).toISOString(), updated_at: this.now, error_code: null };
            await this.store.saveWork(next, w.revision);
            return next;
        });
        if (!snapshot)
            return;
        const w = snapshot, controller = new AbortController();
        let output: PortfolioResult | null = null, error: string | null = null, polling = false, timedOut = false;
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, PORTFOLIO_LIMITS.timeoutMs), poll = setInterval(() => { if (polling)
            return; polling = true; void this.repo.transaction(o, async () => { const current = await this.store.work(o, id); if (!current || current.status !== "running" || current.fence !== w.fence || current.lease_until! <= this.now)
            throw Error(); await this.valid(current); }).catch(() => controller.abort()).finally(() => { polling = false; }); }, 1000);
        try {
            output = await this.compute(w.context, w.input, controller.signal);
            controller.signal.throwIfAborted();
            if (Buffer.byteLength(JSON.stringify(output)) > 6 * 1024 * 1024)
                throw Error("PORTFOLIO_RESULT_CAPACITY");
        }
        catch (e) {
            const reason = (e as Error).message;
            error = timedOut ? "TIMEOUT" : controller.signal.aborted ? "CANCELLED_OR_CONTEXT_CHANGED" : ["PORTFOLIO_INPUT_INVALID", "PORTFOLIO_RESULT_CAPACITY"].includes(reason) ? reason : "PORTFOLIO_COMPUTATION_FAILED";
        }
        finally {
            clearTimeout(timeout);
            clearInterval(poll);
            controller.abort();
        }
        return this.repo.transaction(o, async () => {
            const current = await this.store.work(o, id);
            if (!current || current.status !== "running" || current.fence !== w.fence || current.lease_until! <= this.now)
                return;
            try {
                await this.valid(current);
            }
            catch {
                error = "PORTFOLIO_CONTEXT_CHANGED";
            }
            if (error)
                return this.failed(current, error);
            const next: PortfolioWork = { ...current, revision: current.revision + 1, status: "succeeded", fence: null, lease_until: null, output, error_code: null, updated_at: this.now };
            await this.store.saveWork(next, current.revision);
            return next;
        });
    }
}
