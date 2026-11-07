import { parentPort, workerData } from "node:worker_threads";
import { computeBacktest } from "./strategy.engine.ts";
try {
  parentPort!.postMessage({ output: computeBacktest(workerData) });
} catch (e) {
  parentPort!.postMessage({
    error:
      (e as Error).message === "BACKTEST_REPORT_CAPACITY_EXCEEDED"
        ? "BACKTEST_REPORT_CAPACITY_EXCEEDED"
        : "BACKTEST_COMPUTATION_FAILED",
  });
}
