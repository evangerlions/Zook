import { randomUUID } from "node:crypto";
import type { LightTickOwner } from "../../lighttick.types.ts";
import type { MarketWork, MarketSnapshot } from "./market-work.types.ts";
import type { DailyDataset } from "./market.types.ts";
import { MarketWorkService, MARKET_LIMITS } from "./market-work.service.ts";
import { DailyMarketAdapter } from "./market.adapter.ts";
import { MarketDataError } from "./market.validation.ts";
import { dailyIndicators } from "./market.indicators.ts";
export class MarketWorkRunner {
  constructor(
    readonly service: MarketWorkService,
    readonly adapter: DailyMarketAdapter,
    readonly authorizeOwner: (
      o: LightTickOwner,
    ) => Promise<void> = async () => {},
    readonly timeoutMs = 45000,
  ) {}
  get repo() {
    return this.service.repo;
  }
  get store() {
    return this.service.store;
  }
  get now() {
    return this.service.clock().toISOString();
  }
  async recover() {
    const rows = await this.store.recoverable(this.now, 100);
    for (const w of rows) await this.service.dispatch(w, w.id);
    return rows.length;
  }
  async context(w: MarketWork) {
    await this.authorizeOwner(w);
    const i = await this.repo.investments.instrument(w, w.instrument_id);
    if (!i || i.archived || i.revision !== w.base_revision)
      throw Error("INSTRUMENT_CONTEXT_CHANGED");
    return i;
  }
  async failed(w: MarketWork, error: string) {
    const next: MarketWork = {
      ...w,
      revision: w.revision + 1,
      status: "failed",
      fence: null,
      lease_until: null,
      error_code: error,
      updated_at: this.now,
    };
    await this.service.terminal(next, w.revision);
    return next;
  }
  async execute(o: LightTickOwner, id: string) {
    const snapshot = await this.repo.transaction(o, async () => {
      const w = await this.store.get(o, id);
      if (
        !w ||
        !["queued", "running"].includes(w.status) ||
        (w.status === "running" && w.lease_until! > this.now)
      )
        return;
      if ((await this.store.active(o, this.now)) >= 2) return;
      if (w.attempt >= MARKET_LIMITS.attempts) {
        await this.failed(w, "ATTEMPTS_EXHAUSTED");
        return;
      }
      let instrument;
      try {
        instrument = await this.context(w);
      } catch {
        await this.failed(w, "INSTRUMENT_CONTEXT_CHANGED");
        return;
      }
      const next: MarketWork = {
        ...w,
        revision: w.revision + 1,
        status: "running",
        attempt: w.attempt + 1,
        fence: randomUUID(),
        lease_until: new Date(
          this.service.clock().getTime() + MARKET_LIMITS.leaseMs,
        ).toISOString(),
        error_code: null,
        updated_at: this.now,
      };
      await this.store.save(next, w.revision);
      return { work: next, instrument };
    });
    if (!snapshot) return;
    const { work: w, instrument } = snapshot,
      controller = new AbortController();
    let polling = false,
      error: string | null = null,
      dataset: DailyDataset | undefined,
      indicators: ReturnType<typeof dailyIndicators> | undefined;
    let timedOut = false;
    let abortListener: () => void = () => {};
    const timer = setTimeout(
        () => {
          timedOut = true;
          controller.abort();
        },
        Math.min(45000, Math.max(1, this.timeoutMs)),
      ),
      poll = setInterval(() => {
        if (polling) return;
        polling = true;
        void this.repo
          .transaction(o, async () => {
            const current = await this.store.get(o, id);
            if (
              !current ||
              current.status !== "running" ||
              current.fence !== w.fence ||
              current.lease_until! <= this.now
            )
              throw Error();
            await this.context(current);
          })
          .catch(() => controller.abort())
          .finally(() => {
            polling = false;
          });
      }, 1000);
    try {
      // External IO, CSV parsing and all indicators stay outside the owner transaction.
      const perform = this.adapter.read(
        w.input.supplier,
        { ...w.input, instrument },
        controller.signal,
      );
      dataset = await Promise.race([
        perform,
        new Promise<never>((_, reject) => {
          abortListener = () =>
            reject(
              new MarketDataError(
                timedOut ? "TIMEOUT" : "CANCELLED_OR_CONTEXT_CHANGED",
              ),
            );
          controller.signal.addEventListener("abort", abortListener, {
            once: true,
          });
          if (controller.signal.aborted) abortListener();
        }),
      ]);
      controller.signal.throwIfAborted();
      indicators = dailyIndicators(dataset.bars);
      if (
        Buffer.byteLength(JSON.stringify({ dataset, indicators })) >
        2 * 1024 * 1024
      )
        throw new MarketDataError("SNAPSHOT_TOO_LARGE", 413);
    } catch (e) {
      error = timedOut
        ? "TIMEOUT"
        : e instanceof MarketDataError
          ? e.reason
          : controller.signal.aborted
            ? "CANCELLED_OR_CONTEXT_CHANGED"
            : "MARKET_INPUT_INVALID";
    } finally {
      clearTimeout(timer);
      clearInterval(poll);
      controller.signal.removeEventListener("abort", abortListener);
      controller.abort();
    }
    return this.repo.transaction(o, async () => {
      const current = await this.store.get(o, id);
      if (
        !current ||
        current.status !== "running" ||
        current.fence !== w.fence ||
        current.lease_until! <= this.now
      )
        return;
      try {
        await this.context(current);
      } catch {
        error = "INSTRUMENT_CONTEXT_CHANGED";
      }
      if (error) return this.failed(current, error);
      const published: MarketSnapshot = {
        id: w.id,
        revision: 1,
        instrument_id: w.instrument_id,
        instrument_revision: w.base_revision,
        work_id: w.id,
        created_at: this.now,
        dataset: dataset!,
        indicators: indicators!,
      };
      await this.store.publish(o, published);
      const next: MarketWork = {
        ...current,
        revision: current.revision + 1,
        status: "succeeded",
        fence: null,
        lease_until: null,
        error_code: null,
        snapshot_id: published.id,
        updated_at: this.now,
      };
      await this.service.terminal(next, current.revision);
      return next;
    });
  }
}
