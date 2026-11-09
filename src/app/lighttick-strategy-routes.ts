import {
  StrategyService,
  BACKTEST_LIMITS,
} from "../modules/lighttick/investments/strategies/strategy.service.ts";
import { BACKTEST_VERSION } from "../modules/lighttick/investments/market/backtest.engine.ts";
import {
  object,
  integer,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
export async function handleStrategies(
  runtime: { strategies?: StrategyService },
  o: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const root = "/api/v1/lighttick/investments/",
    path = r.path.slice(root.length);
  if (!r.path.startsWith(root) || !/^(strategies|backtests)(?:\/|$)/.test(path))
    return;
  const base = runtime.strategies;
  if (!base) fail(503, "Strategy worker unavailable.");
  const s = new StrategyService(base.repo, base.queue, authorize, base.clock),
    q = r.query ?? {},
    key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "",
    limit = (fallback: number, max = 50) =>
      q.limit === undefined ? fallback : integer(Number(q.limit), 1, max);
  if (r.method === "GET" && path === "strategies/catalog") {
    await authorize();
    return {
      algorithm_version: BACKTEST_VERSION,
      strategies: ["threshold", "ma_cross"],
      grid_parameters: [
        "entry_above",
        "exit_below",
        "fast_window",
        "slow_window",
      ],
      limits: BACKTEST_LIMITS,
      scope:
        "Saved daily sources, declared SSE/SZSE stock T+1 execution. Owner facts are not independently verified; missing is incomplete. No trading or arbitrary code.",
    };
  }
  if (r.method === "GET" && path === "strategies") {
    if (
      q.include_archived !== undefined &&
      !["true", "false"].includes(q.include_archived)
    )
      fail(422, "Boolean include_archived required.");
    return s.listDefinitions(
      o,
      q.cursor,
      limit(20),
      q.include_archived === "true",
    );
  }
  const d =
    /^strategies\/(inv-[a-zA-Z0-9_-]+)(?:\/(archive|restore|history|versions\/(\d+)))?$/.exec(
      path,
    );
  if (d) {
    if (r.method === "GET" && (!d[2] || d[3]))
      return s.readDefinition(o, d[1], d[3] ? Number(d[3]) : undefined);
    if (r.method === "GET" && d[2] === "history")
      return s.history(o, d[1], q.cursor, limit(10, 20));
    if (r.method === "PUT" && !d[2])
      return s.writeDefinition(o, d[1], object(r.body), key);
    if (r.method === "POST" && ["archive", "restore"].includes(d[2]))
      return s.archiveDefinition(
        o,
        d[1],
        object(r.body),
        key,
        d[2] === "archive",
      );
  }
  if (path === "backtests") {
    if (r.method === "POST") return s.createRun(o, object(r.body), key);
    if (r.method === "GET")
      return s.listRuns(o, q.cursor, limit(20), q.strategy_id);
  }
  const w =
    /^backtests\/(inv-[a-zA-Z0-9_-]+)(?:\/(cancel|cases\/(\d+)))?$/.exec(path);
  if (w) {
    if (r.method === "GET" && !w[2]) return s.readRun(o, w[1]);
    if (r.method === "POST" && w[2] === "cancel")
      return s.cancel(o, w[1], object(r.body), key);
    if (r.method === "GET" && w[3])
      return s.casePage(
        o,
        w[1],
        Number(w[3]),
        q.section ?? "",
        q.cursor,
        limit(50, 100),
      );
  }
  fail(404, "Strategy/backtest route not found.");
}
