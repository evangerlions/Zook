import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
const PREFIX = "/api/v1/lighttick/";
export function assertGuestRouteAllowed(request: HttpRequest) {
  const path = request.path;
  if (path === `${PREFIX}account/upgrade`)
    throw new ApplicationError(403, "LIGHTTICK_APP_ACCESS_DENIED", "A registered LightTick account is required.");
  const allowed = path === `${PREFIX}account/session`
    || path === `${PREFIX}profile`
    || path === `${PREFIX}goals`
    || path === `${PREFIX}plans`
    || path === `${PREFIX}today`
    || path === `${PREFIX}onboarding/starter`
    || path === `${PREFIX}onboarding/first-action`
    || path === `${PREFIX}onboarding/commitment`
    || /^\/api\/v1\/lighttick\/goals\/[^/]+$/.test(path)
    || /^\/api\/v1\/lighttick\/tasks\/[^/]+\/(start|complete|skip|defer|cancel|variant)$/.test(path);
  if (!allowed) throw new ApplicationError(403, "APP_SCOPE_FORBIDDEN", "Guest sessions cannot access this LightTick capability.");
}

