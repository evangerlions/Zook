import {handleWeeklyCardRequest} from "./lighttick-weekly-card-routes.ts";
import {handleParticipationRequest} from "./lighttick-participation-routes.ts";
import {handleBackupRequest} from "./lighttick-backup-routes.ts";
import {handleReminderRequest} from "./lighttick-reminder-routes.ts";
import { onboardingData } from "./lighttick-route-mappers.ts";
import { noStoreResponse } from "./lighttick-v1-http.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";

export async function handleLightTickWebV1Request(
  context: BackendRouteContext,
  runtime: LightTickRuntime,
  owner: LightTickOwner,
  request: HttpRequest,
  authorize: () => Promise<void>,
) {
  if (request.path === "/api/v1/lighttick/onboarding" && request.method === "GET") {
    return noStoreResponse(context, request, onboardingData(await runtime.progressive.snapshot(owner)));
  }
  const weeklyResult = await handleWeeklyCardRequest(runtime, owner, request, authorize);
  if (weeklyResult !== undefined) return noStoreResponse(context, request, weeklyResult);
  const participationResult = await handleParticipationRequest(runtime, owner, request, authorize);
  if (participationResult !== undefined) return noStoreResponse(context, request, participationResult);
  const backupResult = await handleBackupRequest(runtime, owner, request, authorize);
  if (backupResult !== undefined) return noStoreResponse(context, request, backupResult);
  const reminderResult = await handleReminderRequest(runtime, owner, request, authorize);
  if (reminderResult !== undefined) return noStoreResponse(context, request, reminderResult);
}
