import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

/** Provides viewer-scoped buddy notification feed, unread state, and safe target routes. */
export class BuddyNotificationService {
  constructor(private readonly database: ApplicationDatabase) {}

  async list(userId: string, limit: number, cursor?: string) {
    const page = await this.database.listFrogSleepBuddyNotifications({
      appId: FROGSLEEP_APP_ID, recipientUserId: userId, limit, cursor,
    });
    return { notifications: page.items.map(toPayload), next_cursor: page.nextCursor };
  }

  async unreadCount(userId: string) {
    return { unread_count: await this.database.countUnreadFrogSleepBuddyNotifications(FROGSLEEP_APP_ID, userId) };
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await this.database.markFrogSleepBuddyNotificationRead(
      FROGSLEEP_APP_ID, userId, notificationId, new Date().toISOString(),
    );
    if (!notification) throw unavailable();
    return toPayload(notification);
  }

  async markAllRead(userId: string) {
    const marked = await this.database.markAllFrogSleepBuddyNotificationsRead(
      FROGSLEEP_APP_ID, userId, new Date().toISOString(),
    );
    return { marked_read_count: marked, unread_count: 0 };
  }

  async resolve(userId: string, notificationId: string) {
    const notification = await this.database.findFrogSleepBuddyNotification(
      FROGSLEEP_APP_ID, userId, notificationId,
    );
    if (!notification || !(await this.targetExists(notification.targetId))) throw unavailable();
    return { notification_id: notification.id, route: notification.safeRoute };
  }

  private async targetExists(targetId: string): Promise<boolean> {
    if (await this.database.findFrogSleepBuddyInvitationBundle(FROGSLEEP_APP_ID, targetId)) return true;
    for (const kind of ["sleep_invite", "focus_invite", "buddy_share", "buddy_interaction", "buddy_joint_activity"] as const) {
      if (await this.database.findFrogSleepEntity(kind, FROGSLEEP_APP_ID, targetId)) return true;
    }
    return false;
  }
}

function unavailable() {
  return new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Buddy notification is not available.");
}

function toPayload(notification: import("../../../shared/types.ts").FrogSleepBuddyNotificationRecord) {
  return { id: notification.id, type: notification.notificationType, target_type: notification.targetType,
    target_id: notification.targetId, route: notification.safeRoute, is_read: Boolean(notification.readAt),
    read_at: notification.readAt, expires_at: notification.expiresAt, created_at: notification.createdAt };
}
