import { RbacService } from "../../modules/iam/rbac.service.ts";

/**
 * RbacGuard is a thin bridge from transport code into the RBAC policy engine.
 */
export class RbacGuard {
  constructor(private readonly rbacService: RbacService) {}

  async assertPermission(appId: string, userId: string, permissionCode: string): Promise<void> {
    await this.rbacService.assertPermission(appId, userId, permissionCode);
  }
}
