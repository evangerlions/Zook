import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import { WeeklyCardService } from "../modules/lighttick/weekly-cards/weekly-card.service.ts";
import { ApplicationError } from "../shared/errors.ts";
export async function handleWeeklyCardRequest(
  rt: LightTickRuntime,
  o: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const m = r.path.match(
    /^\/api\/v1\/lighttick\/weekly-cards(?:\/(\d{4}-\d{2}-\d{2}))?$/,
  );
  if (!m) return;
  const s = new WeeklyCardService(rt.repository, () => new Date(), authorize);
  if (r.method === "GET" && !m[1])
    return s.read(
      o,
      typeof r.query?.week_start === "string" ? r.query.week_start : undefined,
      typeof r.query?.target_q === "string" ? r.query.target_q : "",
    );
  if (r.method === "PUT" && m[1]) {
    if (!r.body || Buffer.byteLength(JSON.stringify(r.body)) > 16000)
      throw new ApplicationError(
        413,
        "VALIDATION_ERROR",
        "周卡请求过大或无效。",
      );
    return s.confirm(
      o,
      m[1],
      r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "",
      r.body,
    );
  }
  throw new ApplicationError(
    405,
    "VALIDATION_ERROR",
    "Unsupported weekly card method.",
  );
}
