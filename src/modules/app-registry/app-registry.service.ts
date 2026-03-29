import { resolveLocalizedAppName as resolveLocalizedAppNameText } from "../../shared/app-name.ts";
import { forbidden } from "../../shared/errors.ts";
import type { AppRecord, TencentSesRegion } from "../../shared/types.ts";
import { randomId } from "../../shared/utils.ts";
import { InMemoryDatabase } from "../../infrastructure/database/prisma/in-memory-database.ts";
import { AppConfigService } from "../../services/app-config.service.ts";

/**
 * AppRegistryService applies app status, join mode and default-role rules.
 */
export class AppRegistryService {
  constructor(
    private readonly database: InMemoryDatabase,
    private readonly appConfigService: AppConfigService,
  ) {}

  getAppOrThrow(appId: string) {
    const app = this.database.findApp(appId);
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

  ensureMembership(appId: string, userId: string, now = new Date()) {
    const app = this.getAppOrThrow(appId);
    const membership = this.database.findAppUser(app.id, userId);

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

    this.database.appUsers.push(autoJoinedMembership);
    this.assignDefaultRole(app.id, userId);
    return autoJoinedMembership;
  }

  ensureExistingMembership(appId: string, userId: string) {
    const membership = this.database.findAppUser(appId, userId);
    if (!membership) {
      forbidden("APP_JOIN_INVITE_REQUIRED", "The user is not a member of the app.");
    }

    if (membership.status === "BLOCKED") {
      forbidden("APP_MEMBER_BLOCKED", "The user is blocked in the current app.");
    }

    return membership;
  }

  private assignDefaultRole(appId: string, userId: string): void {
    const defaultRoleCode = this.appConfigService.getDefaultRoleCode(appId);
    const role = this.database.findRole(appId, defaultRoleCode);
    if (!role) {
      return;
    }

    const existing = this.database.userRoles.find(
      (item) => item.appId === appId && item.userId === userId && item.roleId === role.id,
    );
    if (existing) {
      return;
    }

    this.database.userRoles.push({
      id: randomId("user_role"),
      appId,
      userId,
      roleId: role.id,
    });
  }
}
