import { resolveLocalizedAppName as resolveLocalizedAppNameText } from "../../shared/app-name.ts";
import { forbidden } from "../../shared/errors.ts";
import type { AppRecord, TencentSesRegion } from "../../shared/types.ts";
import { randomId } from "../../shared/utils.ts";
import { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import { VersionedAppConfigService } from "../../services/versioned-app-config.service.ts";

/**
 * AppRegistryService applies app status, join mode and default-role rules.
 */
export class AppRegistryService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly appConfigService: VersionedAppConfigService,
  ) {}

  async getAppOrThrow(appId: string) {
    const app = await this.database.findApp(appId);
    if (!app) {
      forbidden("APP_NOT_FOUND", "The app does not exist.");
    }

    if (app.status === "BLOCKED") {
      forbidden("APP_BLOCKED", "The app is blocked.");
    }

    return app;
  }

  resolveLocalizedAppName(
    app: AppRecord,
    options: {
      locale?: string;
      region?: TencentSesRegion;
      countryCode?: string;
    } = {},
  ): string {
    return resolveLocalizedAppNameText(app.nameI18n, {
      fallbackName: app.name,
      locale: options.locale,
      region: options.region,
      countryCode: options.countryCode,
    });
  }

  async ensureMembership(appId: string, userId: string, now = new Date()) {
    const app = await this.getAppOrThrow(appId);
    const membership = await this.database.findAppUser(app.id, userId);

    if (membership) {
      if (membership.status === "BLOCKED") {
        forbidden("APP_MEMBER_BLOCKED", "The user is blocked in the current app.");
      }

      return membership;
    }

    if (app.joinMode === "INVITE_ONLY") {
      forbidden("APP_JOIN_INVITE_REQUIRED", "This app requires an invite to join.");
    }

    const autoJoinedMembership = {
      id: randomId("app_user"),
      appId: app.id,
      userId,
      status: "ACTIVE" as const,
      joinedAt: now.toISOString(),
    };

    await this.database.insertAppUser(autoJoinedMembership);
    await this.assignDefaultRole(app.id, userId);
    return autoJoinedMembership;
  }

  async ensureExistingMembership(appId: string, userId: string) {
    const membership = await this.database.findAppUser(appId, userId);
    if (!membership) {
      forbidden("APP_JOIN_INVITE_REQUIRED", "The user is not a member of the app.");
    }

    if (membership.status === "BLOCKED") {
      forbidden("APP_MEMBER_BLOCKED", "The user is blocked in the current app.");
    }

    return membership;
  }

  private async assignDefaultRole(appId: string, userId: string): Promise<void> {
    const defaultRoleCode = await this.appConfigService.getDefaultRoleCode(appId);
    const role = await this.database.findRole(appId, defaultRoleCode);
    if (!role) {
      return;
    }

    const existing = await this.database.findUserRole(appId, userId, role.id);
    if (existing) {
      return;
    }

    await this.database.insertUserRole({
      id: randomId("user_role"),
      appId,
      userId,
      roleId: role.id,
    });
  }
}
