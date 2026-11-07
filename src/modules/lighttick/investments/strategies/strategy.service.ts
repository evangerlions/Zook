import { instant } from "../market/backtest.validation.ts";
import {
  StrategyDefinitions,
  decodeCursor,
  encodeCursor,
} from "./strategy.definitions.ts";
import {
  strategyRef,
  expandCases,
  executionReview,
  digest,
  timestamp,
} from "./strategy.validation.ts";
import {
  keys,
  integer,
  fail,
} from "../../learning/native-learning.validation.ts";
import { investmentId } from "../investment.service.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import type { LightTickRepository } from "../../lighttick.repository.ts";
import type { JobQueue } from "../../../../infrastructure/queue/job-queue.ts";
import { BACKTEST_VERSION } from "../market/backtest.engine.ts";
import { marketDate, shanghaiClock } from "../market/market.validation.ts";
import { referenceCalendar } from "../market/market.calendar.ts";
import { page } from "../screening/screen.definitions.ts";
import {
  publicWork,
  type BacktestInput,
  type BacktestWork,
  type StrategyDefinition,
  type RunMode,
  type GridAxis,
} from "./strategy.types.ts";
export const BACKTEST_JOB = "lighttick.investment.backtest";
export const BACKTEST_LIMITS = {
  retained: 100,
  daily: 20,
  active: 1,
  input_bytes: 2 * 1024 * 1024,
  bars: 500,
  cases: 16,
  timeout_ms: 30000,
  lease_ms: 60000,
  attempts: 3,
};
export class StrategyService extends StrategyDefinitions {
  constructor(
    repo: LightTickRepository,
    readonly queue: JobQueue,
    authorize = async () => {},
    clock = () => new Date(),
  ) {
    super(repo, authorize, clock);
  }
  async context(o: LightTickOwner, input: BacktestInput) {
    for (const frozen of input.strategy_heads) {
      const current = await this.store.definition(o, frozen.id);
      if (
        !current ||
        current.archived ||
        current.archive_epoch !== frozen.archive_epoch
      )
        fail(409, "Strategy archived or unavailable.");
    }
    const i = await this.repo.investments.instrument(o, input.instrument.id);
    if (!i || i.archived || i.revision !== input.instrument.revision)
      fail(409, "Backtest instrument changed.");
    if (input.account_id) {
      const a = await this.repo.investments.account(o, input.account_id);
      if (!a || a.archived) fail(409, "Backtest account unavailable.");
    }
  }
  async createRun(o: LightTickOwner, b: Record<string, unknown>, key: string) {
    keys(b, [
      "mode",
      "strategies",
      "axes",
      "instrument_id",
      "account_id",
      "snapshot_id",
      "input_digest",
      "start_at",
      "end_at",
      "decision_at",
      "execution_review",
      "consent",
    ]);
    const instrument_id = investmentId(b.instrument_id),
      snapshot_id = investmentId(b.snapshot_id),
      account_id = b.account_id === null ? null : investmentId(b.account_id),
      mode = b.mode as RunMode;
    const start_at = marketDate(b.start_at),
      end_at = marketDate(b.end_at),
      decision_at = timestamp(b.decision_at);
    if (
      b.consent !== true ||
      start_at > end_at ||
      instant(decision_at) > BigInt(this.clock().getTime()) * 1000n ||
      end_at > shanghaiClock(new Date(decision_at)).slice(0, 10)
    )
      fail(
        422,
        "Review explicit source/parameters and nonfuture data range/decision time.",
      );
    if (
      !Array.isArray(b.strategies) ||
      !b.strategies.length ||
      b.strategies.length > 4
    )
      fail(422, "Select 1..4 exact strategy versions.");
    const refs = b.strategies.map(strategyRef),
      review = executionReview(b.execution_review, decision_at);
    const id = "inv-backtest-" + digest([o, key]).slice(0, 40);
    await this.command(
      o,
      key,
      "investment_backtest",
      id,
      "create",
      b,
      async (now) => {
        const works = await this.store.works(o);
        if (works.length >= BACKTEST_LIMITS.retained)
          fail(413, "Backtest retention capacity exhausted.");
        if (
          works.some((w) => ["queued", "running"].includes(w.status)) ||
          works.filter((w) => w.created_at.slice(0, 10) === now.slice(0, 10))
            .length >= BACKTEST_LIMITS.daily
        )
          fail(429, "Backtest active or daily budget exhausted.");
        const instrument = await this.repo.investments.instrument(
          o,
          instrument_id,
        );
        if (
          !instrument ||
          instrument.archived ||
          instrument.kind !== "stock" ||
          !["SSE", "SZSE"].includes(instrument.market)
        )
          fail(
            422,
            "This daily T+1 model supports declared SSE/SZSE stocks only.",
          );
        const snapshot = await this.repo.investments.market.snapshot(
          o,
          snapshot_id,
        );
        if (
          !snapshot ||
          snapshot.instrument_id !== instrument_id ||
          snapshot.dataset.input_digest !== b.input_digest
        )
          fail(404, "Exact owner/instrument daily source unavailable.");
        if (Date.parse(snapshot.dataset.available_at) > Date.parse(decision_at))
          fail(422, "Daily source not available at decision time.");
        if (snapshot.dataset.bars.length > BACKTEST_LIMITS.bars)
          fail(413, "Select a saved source with at most 500 bars.");
        if (start_at < snapshot.dataset.start || end_at > snapshot.dataset.end)
          fail(422, "Backtest range must lie within selected source coverage.");
        if (
          end_at === shanghaiClock(new Date(decision_at)).slice(0, 10) &&
          shanghaiClock(new Date(decision_at)).slice(11, 16) < "15:30"
        )
          fail(422, "Current daily session is not yet complete.");
        if (
          review?.facts.some(
            (f) => !snapshot.dataset.bars.some((bar) => bar.date === f.date),
          )
        )
          fail(
            422,
            "Execution facts must refer to dates in the selected source.",
          );
        const strategies: StrategyDefinition[] = [],
          strategy_heads: { id: string; archive_epoch: number }[] = [];
        for (const ref of refs) {
          const d = await this.store.definition(o, ref.id, ref.version),
            current = await this.store.definition(o, ref.id);
          if (
            !d ||
            !current ||
            current.archived ||
            d.definition_digest !== ref.definition_digest ||
            digest(d.fields) !== ref.definition_digest
          )
            fail(409, "Exact active strategy version/digest unavailable.");
          strategies.push(d);
          strategy_heads.push({
            id: d.id,
            archive_epoch: current.archive_epoch,
          });
        }
        const cases = expandCases(mode, strategies, b.axes),
          calendar = referenceCalendar(
            instrument.market,
            snapshot.dataset.start,
            end_at,
            new Date(decision_at),
          );
        const frozen = {
          strategy_heads,
          mode,
          strategies,
          cases,
          axes: b.axes as GridAxis[],
          instrument,
          account_id,
          snapshot,
          calendar,
          start_at,
          end_at,
          decision_at,
          execution_review: review,
          algorithm_version: BACKTEST_VERSION,
        };
        if (
          Buffer.byteLength(JSON.stringify(frozen)) >
          BACKTEST_LIMITS.input_bytes
        )
          fail(413, "Frozen backtest input exceeds capacity.");
        const input: BacktestInput = { ...frozen, digest: digest(frozen) };
        await this.context(o, input);
        const w: BacktestWork = {
          ...o,
          id,
          sequence: works.length + 1,
          revision: 1,
          request_key: key,
          command_keys: [key],
          input,
          status: "queued",
          attempt: 0,
          fence: null,
          lease_until: null,
          error_code: null,
          output: null,
          created_at: now,
          updated_at: now,
        };
        await this.store.saveWork(w, 0);
        return { id };
      },
    );
    await this.dispatch(o, id);
    return this.readRun(o, id);
  }
  async readRun(o: LightTickOwner, id: string) {
    investmentId(id);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const w = await this.store.work(o, id);
      if (!w) fail(404, "Backtest unavailable.");
      return publicWork(w);
    });
  }
  async listRuns(
    o: LightTickOwner,
    cursor = "",
    limit = 20,
    strategy?: string,
  ) {
    integer(limit, 1, 50);
    if (strategy) investmentId(strategy);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const rows = await this.store.works(o);
      if (rows.length > 100) fail(413, "Backtest catalog capacity exceeded.");
      return page(
        rows.filter((w) => !strategy || w.strategy_ids.includes(strategy)),
        [o, "backtests", strategy ?? null],
        cursor,
        limit,
        (w) => w.id,
      );
    });
  }
  async casePage(
    o: LightTickOwner,
    id: string,
    index: number,
    section: string,
    cursor = "",
    limit = 50,
  ) {
    investmentId(id);
    integer(index, 0, 15);
    integer(limit, 1, 100);
    if (
      !["equity", "orders", "trades", "execution", "prices"].includes(section)
    )
      fail(422, "Select equity, orders, trades, execution or prices.");
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const w = await this.store.work(o, id),
        c = w?.output?.cases[index];
      if (w?.status !== "succeeded" || !c)
        fail(404, "Completed case unavailable.");
      const scope = digest([o, id, w.output!.output_digest, index, section]),
        rows =
          section === "execution"
            ? (w.input.execution_review?.facts ?? [])
            : section === "prices"
              ? w.input.snapshot.dataset.bars
              : c.result[section as "equity" | "orders" | "trades"];
      let offset = 0;
      if (cursor) {
        const c = decodeCursor(cursor);
        if (
          c.scope !== scope ||
          !Number.isInteger(c.offset) ||
          c.offset < 0 ||
          c.offset >= rows.length
        )
          fail(409, "Case cursor changed; rebuild reads, retain drafts.");
        offset = c.offset;
      }
      return {
        items: rows.slice(offset, offset + limit),
        case_index: index,
        section,
        total: rows.length,
        output_digest: w.output!.output_digest,
        next_cursor:
          offset + limit < rows.length
            ? encodeCursor({ scope, offset: offset + limit })
            : null,
      };
    });
  }
  async cancel(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    investmentId(id);
    keys(b, ["base_revision"]);
    const base = integer(b.base_revision, 1, 2147483646);
    return this.command(
      o,
      key,
      "investment_backtest",
      id,
      "cancel",
      b,
      async (now) => {
        const w = await this.store.work(o, id);
        if (!w) fail(404, "Backtest unavailable.");
        if (w.revision !== base || !["queued", "running"].includes(w.status))
          fail(409, "Backtest revision/status changed.");
        const n = {
          ...w,
          revision: base + 1,
          status: "cancelled" as const,
          command_keys: [...w.command_keys, key],
          fence: null,
          lease_until: null,
          updated_at: now,
        };
        await this.store.saveWork(n, base);
        return publicWork(n);
      },
    );
  }
  async dispatch(o: LightTickOwner, id: string) {
    const w = await this.store.work(o, id);
    if (
      !w ||
      !["queued", "running"].includes(w.status) ||
      (w.status === "running" && w.lease_until! > this.clock().toISOString())
    )
      return;
    try {
      await this.queue.add(
        BACKTEST_JOB,
        { app_id: o.appId, user_id: o.userId, work_id: id },
        {
          jobId: "backtest-" + digest([o, id, w.attempt]).slice(0, 40),
          attempts: 1,
        },
      );
    } catch {
      /* Persistent recovery redelivers original work. */
    }
  }
}
