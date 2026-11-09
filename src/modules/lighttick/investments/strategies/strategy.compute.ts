import { Worker } from "node:worker_threads";
import type { BacktestInput, BacktestReport } from "./strategy.types.ts";
/** Fixed local module only. No user code, network or queue processes are created here. */
export function computeInThread(
  input: BacktestInput,
  signal: AbortSignal,
): Promise<BacktestReport> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Error("CANCELLED_OR_TIMEOUT"));
      return;
    }
    const worker = new Worker(
      new URL(
        "./strategy.thread" + (import.meta.url.endsWith(".ts") ? ".ts" : ".js"),
        import.meta.url,
      ),
      {
        workerData: input,
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 16,
        },
      },
    );
    let settled = false;
    const finish = (error: Error | null, output?: BacktestReport) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      void worker.terminate();
      if (error) reject(error);
      else resolve(output!);
    };
    const abort = () => finish(Error("CANCELLED_OR_TIMEOUT"));
    signal.addEventListener("abort", abort, { once: true });
    worker.once("message", (message) =>
      message.output
        ? finish(null, message.output)
        : finish(Error(message.error ?? "BACKTEST_COMPUTATION_FAILED")),
    );
    worker.once("error", (error) =>
      finish(error instanceof Error ? error : Error("BACKTEST_THREAD_FAILED")),
    );
    worker.once("exit", () => {
      if (!settled) finish(Error("BACKTEST_THREAD_EXITED"));
    });
    if (signal.aborted) abort();
  });
}
