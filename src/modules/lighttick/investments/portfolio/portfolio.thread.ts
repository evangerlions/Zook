import { parentPort, workerData } from "node:worker_threads";
import { calculatePortfolio } from "./portfolio.engine.ts";
try {
    const output = calculatePortfolio(workerData.context, workerData.input);
    if (Buffer.byteLength(JSON.stringify(output)) > 6 * 1024 * 1024)
        throw Error("PORTFOLIO_RESULT_CAPACITY");
    parentPort!.postMessage({ output });
}
catch (e) {
    parentPort!.postMessage({ error: (e as any)?.statusCode === 422 || (e as any)?.statusCode === 409 ? "PORTFOLIO_INPUT_INVALID" : ["PORTFOLIO_RESULT_CAPACITY","PORTFOLIO_CALENDAR_UNAVAILABLE","PORTFOLIO_ALGORITHM_UNAVAILABLE"].includes((e as Error).message) ? (e as Error).message : "PORTFOLIO_COMPUTATION_FAILED" });
}
