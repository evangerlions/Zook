import { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import { randomId } from "../../shared/utils.ts";

/**
 * AuditInterceptor captures mutating business actions into audit_logs.
 */
export class AuditInterceptor {
  constructor(private readonly database: ApplicationDatabase) {}

  async record(entry: {
    appId: string;
    actorUserId?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    resourceOwnerUserId?: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.database.insertAuditLog({
      id: randomId("audit"),
      appId: entry.appId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      resourceOwnerUserId: entry.resourceOwnerUserId,
      payload: structuredClone(entry.payload),
      createdAt: new Date().toISOString(),
    });
  }
}
