import type { FrogSleepEntityRecord } from "../../../shared/types.ts";

function asPayload(record?: FrogSleepEntityRecord): Record<string, unknown> {
  return record?.payload ?? {};
}

function otherUserId(record: FrogSleepEntityRecord, userId: string): string {
  return record.ownerUserId === userId ? (record.partnerUserId as string) : (record.ownerUserId as string);
}

function toIosParticipantState(state: string): string {
  return state === "pending" ? "invited" : state;
}

export function toSleepInviteResponse(invite: FrogSleepEntityRecord) {
  const payload = asPayload(invite);
  const shareLink = payload.shareLink ?? payload.share_link;
  const inviteeEmailSnapshot = payload.inviteeEmailSnapshot ?? payload.invitee_email_snapshot;
  return {
    id: invite.id,
    invite_id: invite.id,
    inviter_user_id: invite.ownerUserId,
    invitee_user_id: invite.partnerUserId,
    invitee_email_snapshot: inviteeEmailSnapshot,
    status: invite.status,
    invite_code: invite.code,
    invite_token: invite.token,
    invite_link: shareLink,
    code: invite.code,
    token: invite.token,
    share_link: shareLink,
    share_title: payload.shareTitle,
    share_subtitle: payload.shareSubtitle,
    expires_at: payload.expires_at ?? payload.expiresAt,
    role: payload.role,
    custom_label: payload.customLabel,
    created_at: invite.createdAt,
  };
}

export function toSleepRelationshipResponse(relationship: FrogSleepEntityRecord, currentUserId: string) {
  return {
    id: relationship.id,
    relationship_id: relationship.id,
    status: relationship.status,
    owner_user_id: relationship.ownerUserId,
    partner_user_id: relationship.partnerUserId,
    buddy_user_id: otherUserId(relationship, currentUserId),
    created_at: relationship.createdAt,
    updated_at: relationship.updatedAt,
  };
}

export function toSleepSessionResponse(session: FrogSleepEntityRecord, currentUserId: string) {
  const participantStates = session.payload.participantStates as Record<string, unknown> | undefined;
  const ownerState = typeof participantStates?.[session.ownerUserId ?? ""] === "string"
    ? toIosParticipantState(String(participantStates?.[session.ownerUserId ?? ""]))
    : "idle";
  const partnerState = typeof participantStates?.[session.partnerUserId ?? ""] === "string"
    ? toIosParticipantState(String(participantStates?.[session.partnerUserId ?? ""]))
    : "idle";
  const dateAnchor = typeof session.payload.dateAnchor === "string"
    ? session.payload.dateAnchor
    : typeof session.payload.date_anchor === "string"
      ? session.payload.date_anchor
      : "";
  return {
    id: session.id,
    session_id: session.id,
    shared_session_id: session.id,
    relationship_id: session.relationshipId,
    status: session.status,
    invite_status: session.status,
    owner_user_id: session.ownerUserId,
    partner_user_id: session.partnerUserId,
    buddy_user_id: otherUserId(session, currentUserId),
    initiator_user_id: session.ownerUserId,
    date_anchor: dateAnchor,
    starts_at: session.startsAt,
    ends_at: session.endsAt,
    started_at: session.startsAt,
    ended_at: session.endsAt,
    participant_states: participantStates ?? {},
    initiator_state: ownerState,
    partner_state: partnerState,
    last_event_type: session.payload.lastEventType,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  };
}
