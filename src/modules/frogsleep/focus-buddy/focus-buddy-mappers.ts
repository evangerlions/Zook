import type { FrogSleepEntityRecord } from "../../../shared/types.ts";

function otherUserId(record: FrogSleepEntityRecord, userId: string): string {
  return record.ownerUserId === userId ? (record.partnerUserId as string) : (record.ownerUserId as string);
}

export function toFocusSessionResponse(session: FrogSleepEntityRecord) {
  return {
    id: session.payload.client_session_id ?? session.id,
    session_id: session.id,
    status: session.status,
    started_at: session.startsAt,
    ended_at: session.endsAt,
    minutes: session.payload.minutes,
    room: session.payload.room,
    room_id: session.payload.room_id ?? session.payload.room,
    goal: session.payload.goal,
    goal_tag: session.payload.goal_tag ?? session.payload.goal,
    planned_minutes: session.payload.planned_minutes ?? session.payload.minutes,
    actual_minutes: session.payload.actual_minutes ?? session.payload.minutes,
    interrupt_count: session.payload.interrupt_count ?? 0,
    created_at: session.createdAt,
  };
}

export function toFocusProfileResponse(profile: FrogSleepEntityRecord) {
  return {
    id: profile.id,
    profile_id: profile.id,
    user_id: profile.ownerUserId,
    status: profile.status,
    is_active: profile.status === "active",
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
    ...profile.payload,
  };
}

export function toFocusRelationshipResponse(
  relationship: FrogSleepEntityRecord,
  userId: string,
  invite?: FrogSleepEntityRecord,
) {
  const viewerRole = relationship.ownerUserId === userId ? "owner" : "partner";
  const expiresAt = invite?.payload.expires_at ?? invite?.payload.expiresAt;
  return {
    id: relationship.id,
    relationship_id: relationship.id,
    status: relationship.status,
    invite_status: relationship.status,
    invite_type: "direct",
    viewer_role: viewerRole,
    invite_direction: viewerRole === "owner" ? "outgoing" : "incoming",
    owner_user_id: relationship.ownerUserId,
    partner_user_id: relationship.partnerUserId,
    buddy_user_id: otherUserId(relationship, userId),
    invite_code: invite?.code,
    invite_token: invite?.token,
    share_link: invite?.payload.shareLink,
    invite_link: invite?.payload.shareLink,
    share_title: invite?.payload.shareTitle,
    share_subtitle: invite?.payload.shareSubtitle,
    expires_at: expiresAt,
    invite_expires_at: expiresAt,
    created_at: relationship.createdAt,
    updated_at: relationship.updatedAt,
  };
}

export function toFocusMessageResponse(message: FrogSleepEntityRecord) {
  const context = {
    sessionType: message.payload.context_session_type ?? message.payload.contextSessionType,
    sessionId: message.payload.context_session_id ?? message.payload.contextSessionId,
  };
  return {
    id: message.id,
    sender_user_id: message.ownerUserId,
    receiver_user_id: message.partnerUserId,
    relationship_id: message.relationshipId,
    ...message.payload,
    sent_at: message.createdAt,
    senderUserId: message.ownerUserId,
    receiverUserId: message.partnerUserId,
    relationshipId: message.relationshipId,
    templateKey: message.payload.template_key ?? message.payload.templateKey,
    customText: message.payload.custom_text ?? message.payload.customText,
    context: context.sessionType || context.sessionId ? context : null,
    sentAt: message.createdAt,
    readAt: message.payload.read_at ?? message.payload.readAt ?? null,
  };
}

export function toFocusAchievementResponse(milestone: FrogSleepEntityRecord) {
  const milestoneId = String(milestone.payload.milestone_id ?? milestone.payload.milestoneId ?? milestone.id);
  const title = typeof milestone.payload.title === "string" ? milestone.payload.title : milestoneId;
  return {
    id: milestone.id,
    milestone_id: milestoneId,
    type: milestone.payload.type ?? milestoneId,
    title,
    description: milestone.payload.description ?? "",
    earned_at: milestone.createdAt,
    notified: Boolean(milestone.payload.notified),
    unlocked: milestone.payload.unlocked ?? true,
    metadata: milestone.payload.metadata ?? null,
  };
}
