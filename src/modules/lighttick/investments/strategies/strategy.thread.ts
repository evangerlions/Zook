import { parentPort, workerData } from "node:worker_threads";
import { computeBacktest } from "./strategy.engine.ts";
try {
  parentPort!.postMessage({ output: computeBacktest(workerData) });
} catch (e) {
  parentPort!.postMessage({
    error: [
      "BACKTEST_REPORT_CAPACITY_EXCEEDED",
      "BACKTEST_ALGORITHM_VERSION_UNAVAILABLE",
    ].includes((e as Error).message)
      ? (e as Error).message
      : "BACKTEST_COMPUTATION_FAILED",
  });
}
