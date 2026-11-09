import { Worker } from "node:worker_threads";
import type { PortfolioContext, PortfolioInput, PortfolioResult } from "./portfolio.types.ts";
/** Only this fixed calculator module runs, with a memory bound and parent cancellation. */
export function computePortfolio(c: PortfolioContext, input: PortfolioInput, signal: AbortSignal): Promise<PortfolioResult> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(Error("CANCELLED_OR_TIMEOUT"));
            return;
        }
        const w = new Worker(new URL("./portfolio.thread" + (import.meta.url.endsWith(".ts") ? ".ts" : ".js"), import.meta.url), { workerData: { context: c, input }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 } });
        let settled = false;
        const finish = (error: Error | null, output?: PortfolioResult) => { if (settled)
            return; settled = true; signal.removeEventListener("abort", abort); void w.terminate(); if (error)
            reject(error);
        else
            resolve(output!); };
        const abort = () => finish(Error("CANCELLED_OR_TIMEOUT"));
        signal.addEventListener("abort", abort, { once: true });
        w.once("message", m => m.output ? finish(null, m.output) : finish(Error(m.error ?? "PORTFOLIO_COMPUTATION_FAILED")));
        w.once("error", e => finish(e instanceof Error ? e : Error("PORTFOLIO_THREAD_FAILED")));
        w.once("exit", () => { if (!settled)
            finish(Error("PORTFOLIO_THREAD_EXITED")); });
        if (signal.aborted)
            abort();
    });
}
