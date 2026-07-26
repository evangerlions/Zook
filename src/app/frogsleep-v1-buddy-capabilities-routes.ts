import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { resolveBuddyGrowthCapabilities } from "../modules/frogsleep/buddy-growth/buddy-growth-capabilities.ts";
import { authenticateFrogSleepRequest, frogSleepOk } from "./frogsleep-v1-common.ts";

const BUDDY_CAPABILITIES_PATH = "/v1/buddy/capabilities";
const CAPABILITIES_TTL_MS = 5 * 60 * 1000;

/** Serves the versioned, non-sensitive ordinary buddy command document. */
export async function tryHandleBuddyCapabilitiesRoutes(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method !== "GET" || request.path !== BUDDY_CAPABILITIES_PATH) {
    return undefined;
  }

  await authenticateFrogSleepRequest(context, request);
  const capabilities = resolveBuddyGrowthCapabilities();
  const invitationCommandsEnabled = capabilities.invitationInbox && capabilities.explicitInviteConsent;
  const interactionsEnabled = capabilities.structuredInteractions;
  return frogSleepOk(context, {
    schema_version: "1",
    buddy_api_version: "1",
    minimum_client_version: "1.0.0",
    expires_at: new Date(Date.now() + CAPABILITIES_TTL_MS).toISOString(),
    commands: {
      create: invitationCommandsEnabled,
      accept: invitationCommandsEnabled,
      preview: invitationCommandsEnabled,
      email_delivery: invitationCommandsEnabled && capabilities.emailDelivery,
      activity: interactionsEnabled,
      share: interactionsEnabled,
      focus_matching: capabilities.focusMatching,
    },
  }, request.requestId as string, { "Cache-Control": "private, max-age=300" });
}
