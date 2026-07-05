import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { FROGSLEEP_APP_ID } from "../modules/frogsleep/frogsleep-app.ts";
import { FrogSleepSleepBuddyService } from "../modules/frogsleep/sleep-buddy/sleep-buddy.service.ts";
import { emitFrogSleepAnalyticsEvent, type FrogSleepAnalyticsEvent } from "../modules/frogsleep/frogsleep-analytics.ts";
import {
  asBody,
  authenticateFrogSleepRequest,
  dualResourcePayload,
  frogSleepOk,
  getFrogSleepInviteLinks,
  requireStringField,
  stringField,
} from "./frogsleep-v1-common.ts";

function sleepBuddyService(context: BackendRouteContext): FrogSleepSleepBuddyService {
  return new FrogSleepSleepBuddyService(context.database, context.notificationService);
}

export async function handleSleepInviteCreate(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await authenticateFrogSleepRequest(context, request);
  const body = asBody(request);
  const inviteLinks = await getFrogSleepInviteLinks(context);
  const invite = await sleepBuddyService(context).createInvite({
    userId: auth.userId,
    invitee: requireStringField(body, "invitee", "target", "email", "user_id", "userId"),
    role: stringField(body, "role"),
    customLabel: stringField(body, "custom_label", "customLabel"),
    sleepInviteBaseUrl: inviteLinks.sleepBuddyBaseUrl,
  });
  emitSleepAnalytics(context, {
    name: "frogsleep_sleep_invite_created",
    appId: FROGSLEEP_APP_ID,
    userId: auth.userId,
    metadata: { invite_id: invite.id },
  });
  return frogSleepOk(context, invite, request.requestId as string);
}

export async function handleSleepInviteAcceptCode(context: BackendRouteContext, request: HttpRequest) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const relationship = await sleepBuddyService(context).acceptInviteByCode(auth.userId, requireStringField(asBody(request), "code"));
  emitSleepAnalytics(context, {
    name: "frogsleep_sleep_invite_accepted",
    appId: FROGSLEEP_APP_ID,
    userId: auth.userId,
    metadata: { relationship_id: relationship.relationship_id },
  });
  return frogSleepOk(context, relationship, request.requestId as string);
}

export async function handleSleepInviteAcceptToken(context: BackendRouteContext, request: HttpRequest) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const relationship = await sleepBuddyService(context).acceptInviteByToken(auth.userId, requireStringField(asBody(request), "token"));
  emitSleepAnalytics(context, {
    name: "frogsleep_sleep_invite_accepted",
    appId: FROGSLEEP_APP_ID,
    userId: auth.userId,
    metadata: { relationship_id: relationship.relationship_id },
  });
  return frogSleepOk(context, relationship, request.requestId as string);
}

export async function handleSleepRelationshipStatus(context: BackendRouteContext, request: HttpRequest) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const snapshot = await sleepBuddyService(context).statusSnapshot(auth.userId);
  return frogSleepOk(context, {
    ...snapshot,
    server_time: new Date().toISOString(),
  }, request.requestId as string);
}

export async function handleSleepCurrentRelationship(context: BackendRouteContext, request: HttpRequest) {
  const auth = await authenticateFrogSleepRequest(context, request);
  return frogSleepOk(
    context,
    dualResourcePayload("relationship", await sleepBuddyService(context).currentRelationship(auth.userId)),
    request.requestId as string,
  );
}

export async function handleSleepRelationshipAction(
  context: BackendRouteContext,
  request: HttpRequest,
  relationshipId: string,
  action: "pause" | "resume" | "revoke",
) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const relationship = await sleepBuddyService(context).relationshipAction(auth.userId, relationshipId, action);
  return frogSleepOk(context, dualResourcePayload("relationship", relationship), request.requestId as string);
}

export async function handleSleepPreferenceUpdate(context: BackendRouteContext, request: HttpRequest, relationshipId: string) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const service = sleepBuddyService(context);
  const preferences = await service.updatePreferences(auth.userId, relationshipId, asBody(request));
  const relationship = await service.relationshipDetail(auth.userId, relationshipId);
  return frogSleepOk(context, { relationship, preferences }, request.requestId as string);
}

export async function handleSleepSessionBegin(context: BackendRouteContext, request: HttpRequest) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const body = asBody(request);
  const session = await sleepBuddyService(context).beginSession(
    auth.userId,
    requireStringField(body, "relationship_id", "relationshipId"),
    stringField(body, "date_anchor", "dateAnchor"),
  );
  emitSleepAnalytics(context, {
    name: "frogsleep_session_started",
    appId: FROGSLEEP_APP_ID,
    userId: auth.userId,
    metadata: { session_id: session.session_id },
  });
  return frogSleepOk(context, session, request.requestId as string);
}

export async function handleSleepActiveSession(context: BackendRouteContext, request: HttpRequest) {
  const auth = await authenticateFrogSleepRequest(context, request);
  return frogSleepOk(
    context,
    dualResourcePayload("session", await sleepBuddyService(context).activeSession(auth.userId)),
    request.requestId as string,
  );
}

export async function handleSleepSessionAccept(context: BackendRouteContext, request: HttpRequest, sessionId: string) {
  const auth = await authenticateFrogSleepRequest(context, request);
  return frogSleepOk(context, await sleepBuddyService(context).acceptSession(auth.userId, sessionId), request.requestId as string);
}

export async function handleSleepSessionEvent(context: BackendRouteContext, request: HttpRequest, sessionId: string) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const body = asBody(request);
  const eventType = requireStringField(body, "event_type", "eventType");
  const session = await sleepBuddyService(context).recordEvent(
    auth.userId,
    sessionId,
    eventType,
    (body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata))
      ? body.metadata as Record<string, unknown>
      : {},
    stringField(body, "occurred_at", "occurredAt") ?? new Date().toISOString(),
  );
  const eventMap: Record<string, FrogSleepAnalyticsEvent["name"]> = {
    interrupted: "frogsleep_session_interrupted",
    returned: "frogsleep_session_returned",
    morning_completed: "frogsleep_morning_completed",
  };
  const mapped = eventMap[eventType];
  if (mapped) {
    emitSleepAnalytics(context, {
      name: mapped,
      appId: FROGSLEEP_APP_ID,
      userId: auth.userId,
      metadata: { session_id: sessionId },
    });
  }
  return frogSleepOk(context, session, request.requestId as string);
}

export async function handleSleepPauseTonight(context: BackendRouteContext, request: HttpRequest, sessionId: string) {
  const auth = await authenticateFrogSleepRequest(context, request);
  return frogSleepOk(context, await sleepBuddyService(context).pauseTonight(auth.userId, sessionId), request.requestId as string);
}

export async function handleSleepLatestSummary(context: BackendRouteContext, request: HttpRequest) {
  const auth = await authenticateFrogSleepRequest(context, request);
  return frogSleepOk(
    context,
    dualResourcePayload("summary", await sleepBuddyService(context).latestSummary(auth.userId)),
    request.requestId as string,
  );
}

export async function handleSleepLatestRecap(context: BackendRouteContext, request: HttpRequest) {
  const auth = await authenticateFrogSleepRequest(context, request);
  return frogSleepOk(
    context,
    dualResourcePayload("recap", await sleepBuddyService(context).latestRecap(auth.userId)),
    request.requestId as string,
  );
}

export async function handleSleepPendingInvites(context: BackendRouteContext, request: HttpRequest) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const invites = await sleepBuddyService(context).pendingInvites(auth.userId);
  return frogSleepOk(context, { invites, pending_invites: invites }, request.requestId as string);
}

export async function handleSleepInviteAction(context: BackendRouteContext, request: HttpRequest, inviteId: string, action: "accept" | "decline" | "cancel") {
  const auth = await authenticateFrogSleepRequest(context, request);
  if (action === "accept") {
    return frogSleepOk(context, await sleepBuddyService(context).acceptInviteById(auth.userId, inviteId), request.requestId as string);
  }
  return frogSleepOk(context, await sleepBuddyService(context).inviteAction(auth.userId, inviteId, action), request.requestId as string);
}

function emitSleepAnalytics(context: BackendRouteContext, event: FrogSleepAnalyticsEvent): void {
  emitFrogSleepAnalyticsEvent({ analyticsService: context.analyticsService }, event);
}
