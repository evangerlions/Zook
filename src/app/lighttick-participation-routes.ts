import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import { ApplicationError } from "../shared/errors.ts";
export async function handleParticipationRequest(
  rt: LightTickRuntime,
  o: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const match = r.path.match(
    /^\/api\/v1\/lighttick\/participation(?:\/(create|revoke|accept|enroll|survey))?$/,
  );
  if (!match) return;
  const s = rt.participation;
  if (!s)
    throw new ApplicationError(
      503,
      "LIGHTTICK_APP_DISABLED",
      "邀请与试用暂不可用。",
    );
  if (r.method === "GET" && !match[1]) return s.read(o);
  if (r.method === "POST" && match[1])
    return s.command(
      o,
      r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "",
      match[1],
      r.body,
      authorize,
    );
}
