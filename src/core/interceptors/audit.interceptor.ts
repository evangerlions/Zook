import { InMemoryDatabase } from "../../infrastructure/database/prisma/in-memory-database.ts";
import { randomId } from "../../shared/utils.ts";

/**
 * AuditInterceptor captures mutating business actions into audit_logs.
 */
export class AuditInterceptor {
  constructor(private readonly database: InMemoryDatabase) {}

  record(entry: {
    appId: string;
    actorUserId?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    resourceOwnerUserId?: string;
    payload: Record<string, unknown>;
  }): void {
    this.database.auditLogs.push({
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
