import { forbidden } from "../../shared/errors.ts";
import { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import { randomId } from "../../shared/utils.ts";

/**
 * RbacService evaluates app-scoped permissions via roles -> role_permissions -> permissions.
 */
export class RbacService {
  constructor(private readonly database: ApplicationDatabase) {}

  async getPermissionCodes(appId: string, userId: string): Promise<string[]> {
    return await this.database.getPermissionCodes(appId, userId);
  }

  async hasPermission(appId: string, userId: string, permissionCode: string): Promise<boolean> {
    return (await this.getPermissionCodes(appId, userId)).includes(permissionCode);
  }

  async assertPermission(appId: string, userId: string, permissionCode: string): Promise<void> {
    if (!(await this.hasPermission(appId, userId, permissionCode))) {
      forbidden("IAM_PERMISSION_DENIED", `Missing permission: ${permissionCode}.`);
    }
  }

  async assignRole(appId: string, userId: string, roleCode: string): Promise<void> {
    const role = await this.database.findRole(appId, roleCode);
    if (!role) {
      return;
    }

    const existing = await this.database.findUserRole(appId, userId, role.id);

    if (!existing) {
      await this.database.insertUserRole({
        id: randomId("user_role"),
        appId,
        userId,
        roleId: role.id,
      });
    }
  }
}
