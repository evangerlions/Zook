import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import { ObservationWorkService } from "../modules/lighttick/investments/observations/observation.work-service.ts";
import { OBS_LIMITS } from "../modules/lighttick/investments/observations/observation.service.ts";
import {
  OBSERVATION_ALGORITHM,
  type ObservationKind,
} from "../modules/lighttick/investments/observations/observation.types.ts";
import {
  object,
  integer,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
export async function handleObservations(
  runtime: { observations?: ObservationWorkService },
  o: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const prefix = "/api/v1/lighttick/investments/observations";
  if (r.path !== prefix && !r.path.startsWith(prefix + "/")) return;
  const base = runtime.observations;
  if (!base) fail(503, "Observation worker unavailable.");
  const s = new ObservationWorkService(
      base.repo,
      base.queue,
      authorize,
      base.clock,
    ),
    path = r.path.slice(prefix.length),
    key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "",
    q = r.query ?? {},
    limit = q.limit === undefined ? 20 : integer(Number(q.limit), 1, 50),
    cursor = q.cursor ?? "";
  if (r.method === "GET" && path === "/catalog") {
    await authorize();
    return {
      algorithm_version: OBSERVATION_ALGORITHM,
      horizons: [1, 3, 5, 10],
      monitor_fields: [
        "close",
        "return_1d_pct",
        "volume_ratio_5",
        "price_above_ma20",
        "ma_bullish",
      ],
      source_policy:
        "Explicit supplier. Automatic latest current-date source must be unique; missing/ambiguous remains unknown. Daily close only; no private HTTPS quote adapter in this slice.",
      limits: OBS_LIMITS,
    };
  }
  if (r.method === "GET" && path === "/source-preview")
    return s.sourcePreview(o, q);
  if (r.method === "GET" && path === "/calibration") return s.calibration(o);
  if (r.method === "GET" && path === "/work")
    return s.listWorks(o, cursor, limit, q.resource_id);
  const work = /^\/work\/(inv-[a-zA-Z0-9_-]+)(?:\/(cancel))?$/.exec(path);
  if (work) {
    if (r.method === "GET" && !work[2]) return s.readWork(o, work[1]);
    if (r.method === "POST" && work[2])
      return s.cancel(o, work[1], object(r.body), key);
    fail(404, "Work route unavailable.");
  }
  const match =
    /^\/(predictions|feedback|monitors|events)(?:\/(inv-[a-zA-Z0-9_-]+)(?:\/(history|archive|restore|stop|read|evaluate|check|versions\/(\d+)))?)?$/.exec(
      path,
    );
  if (!match) fail(404, "Observation route not found.");
  const kind = match[1] as ObservationKind,
    id = match[2],
    action = match[3];
  if (r.method === "GET" && !id) {
    for (const k of ["include_archived", "unread"])
      if (q[k] !== undefined && !["true", "false"].includes(q[k]))
        fail(422, "Boolean query required.");
    return s.listObservations(
      o,
      kind,
      cursor,
      limit,
      q.include_archived === "true",
      q.resource_id,
      q.unread === "true",
    );
  }
  if (r.method === "GET" && id && (!action || match[4]))
    return s.readObservation(
      o,
      kind,
      id,
      match[4] ? Number(match[4]) : undefined,
    );
  if (r.method === "GET" && action === "history")
    return s.history(o, kind, id, cursor, Math.min(limit, 20));
  if (r.method === "PUT" && id && !action && kind !== "events")
    return s.write(o, kind, id, object(r.body), key);
  if (
    r.method === "POST" &&
    ["archive", "restore", "stop", "read"].includes(action)
  )
    return s.transition(o, kind, id, object(r.body), key, action as any);
  if (
    r.method === "POST" &&
    ((action === "evaluate" && kind === "predictions") ||
      (action === "check" && kind === "monitors"))
  )
    return s.createWork(
      o,
      action === "evaluate" ? "evaluation" : "check",
      id,
      object(r.body),
      key,
    );
  fail(404, "Observation route not found.");
}
