import { randomUUID } from "node:crypto";
import type { LightTickOwner } from "../../lighttick.types.ts";
import { StrategyService, BACKTEST_LIMITS } from "./strategy.service.ts";
import { computeInThread } from "./strategy.compute.ts";
import type { BacktestReport } from "./strategy.types.ts";
export class StrategyRunner {
  constructor(
    readonly service: StrategyService,
    readonly authorizeOwner: (
      o: LightTickOwner,
    ) => Promise<void> = async () => {},
    readonly compute = computeInThread,
  ) {}
  async recover() {
    const rows = await this.service.store.recoverable(
      this.service.clock().toISOString(),
    );
    for (const w of rows) await this.service.dispatch(w, w.id);
    return rows.length;
  }
  async execute(o: LightTickOwner, id: string) {
    const s = this.service,
      store = s.store,
      now = () => s.clock().toISOString();
    const claim = await s.repo.transaction(o, async () => {
      const w = await store.work(o, id);
      if (
        !w ||
        !["queued", "running"].includes(w.status) ||
        (w.status === "running" && w.lease_until! > now())
      )
        return;
      try {
        await this.authorizeOwner(o);
      } catch {
        await store.saveWork(
          {
            ...w,
            revision: w.revision + 1,
            status: "failed",
            output: null,
            error_code: "BACKTEST_PERMISSION_REVOKED",
            fence: null,
            lease_until: null,
            updated_at: now(),
          },
          w.revision,
        );
        return;
      }
      if (w.attempt >= BACKTEST_LIMITS.attempts) {
        await store.saveWork(
          {
            ...w,
            revision: w.revision + 1,
            status: "failed",
            error_code: "RECOVERY_EXHAUSTED",
            fence: null,
            lease_until: null,
            updated_at: now(),
          },
          w.revision,
        );
        return;
      }
      const n = {
        ...w,
        revision: w.revision + 1,
        status: "running" as const,
        attempt: w.attempt + 1,
        fence: randomUUID(),
        lease_until: new Date(
          s.clock().getTime() + BACKTEST_LIMITS.lease_ms,
        ).toISOString(),
        updated_at: now(),
      };
      await store.saveWork(n, w.revision);
      return n;
    });
    if (!claim) return;
    const abort = new AbortController();
    let output: BacktestReport | null = null,
      error: string | null = null,
      polling = false,
      phase: "context" | "compute" = "context";
    const check = () =>
      s.repo.transaction(o, async () => {
        await this.authorizeOwner(o);
        const w = await store.work(o, id);
        if (
          !w ||
          w.status !== "running" ||
          w.fence !== claim.fence ||
          w.lease_until! <= now()
        )
          throw Error("STALE");
        await s.context(o, claim.input);
      });
    const timer = setTimeout(() => abort.abort(), BACKTEST_LIMITS.timeout_ms),
      poll = setInterval(() => {
        if (polling) return;
        polling = true;
        void check()
          .catch(() => abort.abort())
          .finally(() => (polling = false));
      }, 250);
    try {
      await check();
      phase = "compute";
      output = await Promise.race([
        this.compute(claim.input, abort.signal),
        new Promise<never>((_, reject) => {
          abort.signal.addEventListener(
            "abort",
            () => reject(Error("CANCELLED_OR_TIMEOUT")),
            { once: true },
          );
          if (abort.signal.aborted) reject(Error("CANCELLED_OR_TIMEOUT"));
        }),
      ]);
      phase = "context";
      await check();
    } catch (failure) {
      const code = (failure as Error).message;
      error = abort.signal.aborted
        ? "CANCELLED_OR_TIMEOUT"
        : [
              "BACKTEST_ALGORITHM_VERSION_UNAVAILABLE",
              "BACKTEST_REPORT_CAPACITY_EXCEEDED",
            ].includes(code)
          ? code
          : phase === "context"
            ? "BACKTEST_INPUT_OR_PERMISSION_CHANGED"
            : (failure as Error).message === "BACKTEST_REPORT_CAPACITY_EXCEEDED"
              ? "BACKTEST_REPORT_CAPACITY_EXCEEDED"
              : "BACKTEST_COMPUTATION_FAILED";
    } finally {
      clearTimeout(timer);
      clearInterval(poll);
      abort.abort();
    }
    return s.repo.transaction(o, async () => {
      const w = await store.work(o, id);
      if (
        !w ||
        w.status !== "running" ||
        w.fence !== claim.fence ||
        w.lease_until! <= now()
      )
        return;
      try {
        await this.authorizeOwner(o);
        await s.context(o, claim.input);
      } catch {
        error ??= "BACKTEST_INPUT_OR_PERMISSION_CHANGED";
      }
      await store.saveWork(
        {
          ...w,
          revision: w.revision + 1,
          status: error ? "failed" : "succeeded",
          output: error ? null : output,
          error_code: error,
          fence: null,
          lease_until: null,
          updated_at: now(),
        },
        w.revision,
      );
    });
  }
}
