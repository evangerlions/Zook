import { forbidden } from "../../shared/errors.ts";
import { InMemoryDatabase } from "../../infrastructure/database/prisma/in-memory-database.ts";
import { randomId } from "../../shared/utils.ts";

/**
 * RbacService evaluates app-scoped permissions via roles -> role_permissions -> permissions.
 */
export class RbacService {
  constructor(private readonly database: InMemoryDatabase) {}

  getPermissionCodes(appId: string, userId: string): string[] {
    return this.database.getPermissionCodes(appId, userId);
  }

  hasPermission(appId: string, userId: string, permissionCode: string): boolean {
    return this.getPermissionCodes(appId, userId).includes(permissionCode);
  }

  assertPermission(appId: string, userId: string, permissionCode: string): void {
    if (!this.hasPermission(appId, userId, permissionCode)) {
      forbidden("IAM_PERMISSION_DENIED", `Missing permission: ${permissionCode}.`);
    }
  }

  assignRole(appId: string, userId: string, roleCode: string): void {
    const role = this.database.findRole(appId, roleCode);
    if (!role) {
      return;
    }

    const existing = this.database.userRoles.find(
      (item) => item.appId === appId && item.userId === userId && item.roleId === role.id,
    );

    if (!existing) {
      this.database.userRoles.push({
        id: randomId("user_role"),
        appId,
        userId,
        roleId: role.id,
      });
    }
  }
}
