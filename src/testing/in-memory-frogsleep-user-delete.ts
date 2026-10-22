import type { InMemoryDatabase } from "./in-memory-database.ts";

export function deleteInMemoryFrogSleepBuddyUserData(db: InMemoryDatabase, appId: string, userId: string): void {
  const relationships = db.frogSleepBuddyDomainRelationships.filter(item => item.appId === appId
    && [item.userIdLow, item.userIdHigh].includes(userId));
  const email = db.findUserById(userId)?.email?.trim().toLowerCase();
  const invitations = db.frogSleepBuddyInvitationBundles.filter(item => item.appId === appId
    && ([item.inviterUserId, item.inviteeUserId].includes(userId) || Boolean(email && item.recipientEmail === email)));
  const ids = new Set([...relationships, ...invitations, ...db.frogSleepEntities.filter(item => item.appId === appId
    && [item.ownerUserId, item.partnerUserId].includes(userId))].map(item => item.id));
  freePartnerSlots(db, appId, userId, ids);
  deleteNotifications(db, appId, userId, ids);
  deleteInvitations(db, appId, userId, ids);
  db.frogSleepBuddyDomainRelationships = db.frogSleepBuddyDomainRelationships.filter(item => item.appId !== appId || !ids.has(item.id));
  db.frogSleepBuddySharingGrants = db.frogSleepBuddySharingGrants.filter(item => item.appId !== appId
    || ![item.grantorUserId, item.granteeUserId].includes(userId));
}

function freePartnerSlots(db: InMemoryDatabase, appId: string, userId: string, ids: Set<string>): void {
  db.frogSleepBuddyDomainSlots = db.frogSleepBuddyDomainSlots.filter(item => item.appId !== appId || item.userId !== userId);
  for (const slot of db.frogSleepBuddyDomainSlots) {
    if (slot.appId !== appId || !slot.relationshipId || !ids.has(slot.relationshipId)) continue;
    slot.state = "available";
    slot.relationshipId = undefined;
    slot.version += 1;
    slot.updatedAt = new Date().toISOString();
  }
}

function deleteInvitations(db: InMemoryDatabase, appId: string, userId: string, ids: Set<string>): void {
  const deliveries = new Set(db.frogSleepBuddyInvitationEmailDeliveries.filter(item => item.appId === appId
    && ids.has(item.invitationId)).map(item => item.id));
  db.frogSleepBuddyInvitationEmailDeliveries = db.frogSleepBuddyInvitationEmailDeliveries.filter(item => !deliveries.has(item.id));
  db.frogSleepBuddyInvitationEmailAttempts = db.frogSleepBuddyInvitationEmailAttempts.filter(item => !deliveries.has(item.deliveryId));
  db.frogSleepBuddyInvitationBundles = db.frogSleepBuddyInvitationBundles.filter(item => item.appId !== appId || !ids.has(item.id));
  db.frogSleepBuddyInvitationDomainDecisions = db.frogSleepBuddyInvitationDomainDecisions.filter(item => item.appId !== appId
    || (!ids.has(item.invitationId) && item.decidedByUserId !== userId));
  db.frogSleepBuddyInvitationReceiptAttempts = db.frogSleepBuddyInvitationReceiptAttempts.filter(item => item.appId !== appId
    || ![item.inviterUserId, item.inviteeUserId].includes(userId));
}

function deleteNotifications(db: InMemoryDatabase, appId: string, userId: string, ids: Set<string>): void {
  const outboxes = new Set(db.frogSleepBuddyNotificationOutbox.filter(item => item.appId === appId
    && (item.recipientUserId === userId || ids.has(item.targetId))).map(item => item.id));
  const notifications = new Set(db.frogSleepBuddyNotifications.filter(item => item.appId === appId
    && (item.recipientUserId === userId || outboxes.has(item.outboxId) || ids.has(item.targetId))).map(item => item.id));
  db.frogSleepBuddyNotificationOutbox = db.frogSleepBuddyNotificationOutbox.filter(item => !outboxes.has(item.id));
  db.frogSleepBuddyNotifications = db.frogSleepBuddyNotifications.filter(item => !notifications.has(item.id));
  db.frogSleepBuddyNotificationDeliveries = db.frogSleepBuddyNotificationDeliveries.filter(item => !notifications.has(item.notificationId));
  db.notificationJobs = db.notificationJobs.filter(item => item.appId !== appId || (item.recipientUserId !== userId
    && !["entityId", "relationshipId", "sessionId"].some(key => ids.has(String(item.payload[key])))));
}
