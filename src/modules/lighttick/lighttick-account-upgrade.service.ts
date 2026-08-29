import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import type { AuthService } from "../auth/auth.service.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId, sha256 } from "../../shared/utils.ts";
import { LIGHTTICK_APP_ID } from "./lighttick-app.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";

export interface UpgradeLightTickGuestCommand {
  operationId: string; guestUserId: string; targetUserId: string;
  guestUpgradeToken: string; deviceId: string; requestId?: string;
}

export class LightTickAccountUpgradeService {
  constructor(private readonly database: ApplicationDatabase, private readonly auth: AuthService,
    private readonly repository: LightTickRepository) {}

  async upgrade(command: UpgradeLightTickGuestCommand, now = new Date()) {
    if (command.guestUserId === command.targetUserId)
      throw new ApplicationError(403, "LIGHTTICK_APP_ACCESS_DENIED", "A guest session cannot upgrade itself.");
    const targetUser = await this.database.findUserById(command.targetUserId);
    const targetMembership = await this.database.findAppUser(LIGHTTICK_APP_ID, command.targetUserId);
    if (!targetUser || targetUser.passwordAlgo === "lighttick-guest" || targetMembership?.status !== "ACTIVE")
      throw new ApplicationError(403, "LIGHTTICK_APP_ACCESS_DENIED", "A registered LightTick account is required.");

    const requestHash = sha256(JSON.stringify({ guestUserId: command.guestUserId,
      targetUserId: command.targetUserId, deviceId: command.deviceId,
      guestUpgradeTokenHash: sha256(command.guestUpgradeToken) }));
    const result = await this.database.withExclusiveSession(async () => {
      const upgraded = await this.repository.upgradeGuestAccount({ appId: LIGHTTICK_APP_ID,
        operationId: command.operationId, requestHash, guestUserId: command.guestUserId,
        targetUserId: command.targetUserId, guestUpgradeTokenHash: sha256(command.guestUpgradeToken),
        deviceId: command.deviceId, now: now.toISOString() });
      await this.database.updateAppUserStatus(LIGHTTICK_APP_ID, command.guestUserId, "DELETED");
      return upgraded;
    });

    await this.auth.revokeAllSessions(LIGHTTICK_APP_ID, command.guestUserId, now);
    await this.database.insertAuditLog({ id: randomId("audit"), appId: LIGHTTICK_APP_ID,
      actorUserId: command.targetUserId, action: result.idempotencyReplayed
        ? "lighttick.guest.upgrade_replayed" : "lighttick.guest.upgraded",
      resourceType: "lighttick_guest_identity", resourceId: command.guestUserId,
      resourceOwnerUserId: command.targetUserId,
      payload: { previousGuestUserIdHash: sha256(command.guestUserId),
        deviceIdHash: sha256(command.deviceId), operationIdHash: sha256(command.operationId), requestId: command.requestId },
      createdAt: now.toISOString() });
    return result;
  }
}
