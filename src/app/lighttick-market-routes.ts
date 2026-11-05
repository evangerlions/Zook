import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { HttpRequest } from "../shared/types.ts";
import { MarketWorkService } from "../modules/lighttick/investments/market/market-work.service.ts";
import {
  object,
  integer,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
export async function handleMarketRequest(
  runtime: LightTickRuntime,
  o: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const prefix = "/api/v1/lighttick/investments/market/";
  if (!r.path.startsWith(prefix)) return;
  const path = r.path.slice(prefix.length);
  if (!runtime.marketWork || !runtime.marketPolicy)
    fail(503, "Market worker is unavailable.");
  const service = new MarketWorkService(
      runtime.repository,
      runtime.marketWork.queue,
      authorize,
      runtime.marketWork.clock,
    ),
    key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
  if (path === "capabilities" && r.method === "GET") {
    await authorize();
    try {
      return await runtime.marketPolicy.capabilities();
    } catch {
      fail(503, "Market provider policy is unavailable.");
    }
  }
  if (path === "snapshots" && r.method === "GET")
    return service.listSnapshots(
      o,
      r.query?.instrument_id,
      r.query?.cursor ?? "",
      r.query?.limit === undefined
        ? 20
        : integer(Number(r.query.limit), 1, 100),
    );
  const work = /^work\/(inv-[a-zA-Z0-9_-]+)(?:\/(cancel))?$/.exec(path),
    data = /^snapshots\/(inv-[a-zA-Z0-9_-]+)$/.exec(path);
  if (r.method === "GET" && work && !work[2])
    return service.readWork(o, work[1]);
  if (r.method === "GET" && data) return service.readSnapshot(o, data[1]);
  if (r.method !== "POST" || (path !== "work" && work?.[2] !== "cancel"))
    fail(404, "Market route was not found.");
  const b = object(r.body);
  if (Buffer.byteLength(JSON.stringify(b)) > 280000)
    fail(413, "Market request exceeds capacity.");
  if (path === "work" && r.method === "POST") return service.create(o, b, key);
  if (work?.[2] === "cancel" && r.method === "POST")
    return service.cancel(o, work[1], b, key);
  fail(404, "Market route was not found.");
}
