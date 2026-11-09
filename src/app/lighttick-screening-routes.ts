import { ScreeningService } from "../modules/lighttick/investments/screening/screen.service.ts";
import {
  SCREEN_ALGORITHM,
  SCREEN_FIELDS,
} from "../modules/lighttick/investments/screening/screen.types.ts";
import { SCREEN_LIMITS } from "../modules/lighttick/investments/screening/screen.service.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import {
  object,
  integer,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
export async function handleScreening(
  runtime: { screening?: ScreeningService },
  o: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const prefix = "/api/v1/lighttick/investments/screening";
  if (r.path !== prefix && !r.path.startsWith(prefix + "/")) return;
  if (!runtime.screening) fail(503, "Screening worker unavailable.");
  const base = runtime.screening,
    s = new ScreeningService(base.repo, base.queue, authorize, base.clock),
    path = r.path.slice(prefix.length),
    key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "",
    cursor = r.query?.cursor ?? "",
    limit = (n: number, max = 50) =>
      r.query?.limit === undefined ? n : integer(Number(r.query.limit), 1, max);
  if (r.method === "GET" && path === "/catalog") {
    await authorize();
    return {
      algorithm_version: SCREEN_ALGORITHM,
      fields: SCREEN_FIELDS,
      recipes: ["ma_bullish", "pullback", "volume_breakout", "return_window"],
      limits: SCREEN_LIMITS,
    };
  }
  if (path === "/runs" && r.method === "POST")
    return s.createRun(o, object(r.body), key);
  if (path === "/runs" && r.method === "GET")
    return s.listRuns(o, cursor, limit(20), r.query?.template_id);
  const work = /^\/runs\/(inv-[a-zA-Z0-9_-]+)(?:\/(cancel))?$/.exec(path);
  if (work) {
    if (r.method === "GET" && !work[2]) return s.readRun(o, work[1]);
    if (r.method === "POST" && work[2])
      return s.cancel(o, work[1], object(r.body), key);
    fail(404, "Screen run route not found.");
  }
  const def =
    /^\/(rules|templates)(?:\/(inv-[a-zA-Z0-9_-]+)(?:\/(history|archive|restore|versions\/(\d+)))?)?$/.exec(
      path,
    );
  if (!def) fail(404, "Screen definition route not found.");
  const kind = def[1] as "rules" | "templates";
  if (r.method === "GET" && !def[2]) {
    if (
      r.query?.include_archived !== undefined &&
      !["true", "false"].includes(r.query.include_archived)
    )
      fail(422, "include_archived must be boolean.");
    return s.listDefinitions(
      o,
      kind,
      cursor,
      limit(20),
      r.query?.include_archived === "true",
    );
  }
  if (r.method === "GET" && (!def[3] || def[4]))
    return s.readDefinition(
      o,
      kind,
      def[2],
      def[4] ? Number(def[4]) : undefined,
    );
  if (r.method === "GET" && def[3] === "history")
    return s.definitionHistory(o, kind, def[2], cursor, limit(10, 20));
  if (r.method === "PUT" && !def[3])
    return s.writeDefinition(o, kind, def[2], object(r.body), key);
  if (r.method === "POST" && ["archive", "restore"].includes(def[3]))
    return s.archiveDefinition(
      o,
      kind,
      def[2],
      object(r.body),
      key,
      def[3] === "archive",
    );
  fail(404, "Screen definition route not found.");
}
