import type { QueryResultRow } from "pg";
import type {
  AnalyticsEventRecord,
  AppConfigRecord,
  AppNameI18n,
  AppRecord,
  AppUserRecord,
  AuditLogRecord,
  FailedEventRecord,
  FileRecord,
  NotificationJobRecord,
  PermissionRecord,
  RolePermissionRecord,
  RoleRecord,
  UserRecord,
  UserRoleRecord,
} from "../../../shared/types.ts";
import { toIsoString } from "./postgres-row-utils.ts";

export function parseApp(row: QueryResultRow): AppRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    nameI18n: (row.name_i18n ?? {}) as AppNameI18n,
    status: row.status as AppRecord["status"],
    apiDomain: row.api_domain ?? undefined,
    joinMode: row.join_mode as AppRecord["joinMode"],
    createdAt: toIsoString(row.created_at) as string,
  };
}

export function parseUser(row: QueryResultRow): UserRecord {
  return {
    id: String(row.id),
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    passwordHash: String(row.password_hash),
    passwordAlgo: String(row.password_algo),
    status: row.status as UserRecord["status"],
    createdAt: toIsoString(row.created_at) as string,
  };
}

export function parseAppUser(row: QueryResultRow): AppUserRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    userId: String(row.user_id),
    status: row.status as AppUserRecord["status"],
    accountRegion: row.account_region as AppUserRecord["accountRegion"],
    joinedAt: toIsoString(row.joined_at) as string,
  };
}

export function parseRole(row: QueryResultRow): RoleRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    code: String(row.code),
    name: String(row.name),
    status: row.status as RoleRecord["status"],
  };
}

export function parsePermission(row: QueryResultRow): PermissionRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    status: row.status as PermissionRecord["status"],
  };
}

export function parseRolePermission(row: QueryResultRow): RolePermissionRecord {
  return {
    id: String(row.id),
    roleId: String(row.role_id),
    permissionId: String(row.permission_id),
  };
}

export function parseUserRole(row: QueryResultRow): UserRoleRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    userId: String(row.user_id),
    roleId: String(row.role_id),
  };
}

export function parseAuditLog(row: QueryResultRow): AuditLogRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    actorUserId: row.actor_user_id ?? undefined,
    action: String(row.action),
    resourceType: String(row.resource_type),
    resourceId: row.resource_id ?? undefined,
    resourceOwnerUserId: row.resource_owner_user_id ?? undefined,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: toIsoString(row.created_at) as string,
  };
}

export function parseNotificationJob(row: QueryResultRow): NotificationJobRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    recipientUserId: String(row.recipient_user_id),
    channel: row.channel as NotificationJobRecord["channel"],
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status as NotificationJobRecord["status"],
    retryCount: Number(row.retry_count ?? 0),
  };
}

export function parseFailedEvent(row: QueryResultRow): FailedEventRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    eventType: String(row.event_type),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    errorMessage: String(row.error_message ?? ""),
    retryCount: Number(row.retry_count ?? 0),
    nextRetryAt: toIsoString(row.next_retry_at) as string,
    createdAt: toIsoString(row.created_at) as string,
  };
}

export function parseAppConfig(row: QueryResultRow): AppConfigRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    configKey: String(row.config_key),
    configValue: String(row.config_value ?? ""),
    updatedAt: toIsoString(row.updated_at) as string,
  };
}

export function parseAnalyticsEvent(row: QueryResultRow): AnalyticsEventRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    userId: String(row.user_id),
    platform: row.platform as AnalyticsEventRecord["platform"],
    sessionId: String(row.session_id),
    pageKey: String(row.page_key),
    eventName: row.event_name as AnalyticsEventRecord["eventName"],
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? undefined : Number(row.duration_ms),
    occurredAt: toIsoString(row.occurred_at) as string,
    receivedAt: toIsoString(row.received_at) as string,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

export function parseFile(row: QueryResultRow): FileRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    ownerUserId: String(row.owner_user_id),
    storageKey: String(row.storage_key),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes ?? 0),
    status: row.status as FileRecord["status"],
    createdAt: toIsoString(row.created_at) as string,
  };
}
