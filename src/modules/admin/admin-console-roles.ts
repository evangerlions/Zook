import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import type { RoleRecord } from "../../shared/types.ts";
import { randomId } from "../../shared/utils.ts";

export async function createDefaultRoles(database: ApplicationDatabase, appId: string): Promise<void> {
  const memberRole: RoleRecord = {
    id: randomId(`role_${appId}_member`),
    appId,
    code: "member",
    name: "Member",
    status: "ACTIVE",
  };
  const adminRole: RoleRecord = {
    id: randomId(`role_${appId}_admin`),
    appId,
    code: "admin",
    name: "Admin",
    status: "ACTIVE",
  };

  await database.insertRoles([memberRole, adminRole]);

  const permissionMap = new Map((await database.listPermissions()).map((item) => [item.code, item.id]));
  const rolePermissionRecords = [];
  for (const code of ["file:read"]) {
    const permissionId = permissionMap.get(code);
    if (permissionId) {
      rolePermissionRecords.push({
        id: randomId(`rp_${appId}_member`),
        roleId: memberRole.id,
        permissionId,
      });
    }
  }

  for (const code of ["file:read", "metrics:read", "notification:send"]) {
    const permissionId = permissionMap.get(code);
    if (permissionId) {
      rolePermissionRecords.push({
        id: randomId(`rp_${appId}_admin`),
        roleId: adminRole.id,
        permissionId,
      });
    }
  }

  await database.insertRolePermissions(rolePermissionRecords);
}
