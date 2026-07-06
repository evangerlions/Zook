import type { QueryResultRow } from "pg";
import type {
  FrogSleepDeviceRecord,
  FrogSleepEntityFilter,
  FrogSleepEntityKind,
  FrogSleepEntityRecord,
} from "../../../shared/types.ts";
import { toIsoString } from "./postgres-row-utils.ts";

type PostgresQuery = (sql: string, values?: unknown[]) => Promise<{ rows: QueryResultRow[] }>;

const FROGSLEEP_ENTITY_TABLES: Record<FrogSleepEntityKind, string> = {
  sleep_invite: "zook_frogsleep_sleep_invites",
  sleep_relationship: "zook_frogsleep_sleep_relationships",
  guardianship_preference: "zook_frogsleep_guardianship_preferences",
  sleep_session: "zook_frogsleep_sleep_sessions",
  sleep_event: "zook_frogsleep_sleep_events",
  sleep_summary: "zook_frogsleep_sleep_summaries",
  night_recap: "zook_frogsleep_night_recaps",
  focus_profile: "zook_frogsleep_focus_profiles",
  focus_relationship: "zook_frogsleep_focus_relationships",
  focus_invite: "zook_frogsleep_focus_invites",
  focus_session: "zook_frogsleep_focus_sessions",
  focus_shared_moment: "zook_frogsleep_focus_shared_moments",
  focus_message: "zook_frogsleep_focus_messages",
  focus_milestone: "zook_frogsleep_focus_milestones",
  focus_match_feedback: "zook_frogsleep_focus_match_feedback",
  sleep_report_snapshot: "zook_frogsleep_sleep_report_snapshots",
  progress_snapshot: "zook_frogsleep_progress_snapshots",
  entitlement_record: "zook_frogsleep_entitlement_records",
};

function tableFor(kind: FrogSleepEntityKind): string {
  return FROGSLEEP_ENTITY_TABLES[kind];
}

function parseDevice(row: QueryResultRow): FrogSleepDeviceRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    userId: String(row.user_id),
    platform: row.platform as FrogSleepDeviceRecord["platform"],
    pushToken: String(row.push_token),
    appVersion: row.app_version ?? undefined,
    timezone: row.timezone ?? undefined,
    pushEnabled: Boolean(row.push_enabled),
    createdAt: toIsoString(row.created_at) as string,
    updatedAt: toIsoString(row.updated_at) as string,
    deletedAt: row.deleted_at ? toIsoString(row.deleted_at) : undefined,
  };
}

function parseEntity(kind: FrogSleepEntityKind, row: QueryResultRow): FrogSleepEntityRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    kind,
    ownerUserId: row.owner_user_id ?? undefined,
    partnerUserId: row.partner_user_id ?? undefined,
    relationshipId: row.relationship_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    status: row.status ?? undefined,
    code: row.code ?? undefined,
    token: row.token ?? undefined,
    startsAt: row.starts_at ? toIsoString(row.starts_at) : undefined,
    endsAt: row.ends_at ? toIsoString(row.ends_at) : undefined,
    occurredAt: row.occurred_at ? toIsoString(row.occurred_at) : undefined,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: toIsoString(row.created_at) as string,
    updatedAt: toIsoString(row.updated_at) as string,
    deletedAt: row.deleted_at ? toIsoString(row.deleted_at) : undefined,
  };
}

export class PostgresFrogSleepStore {
  constructor(private readonly query: PostgresQuery) {}

  async upsertDevice(record: FrogSleepDeviceRecord): Promise<FrogSleepDeviceRecord> {
    const result = await this.query(
      `INSERT INTO zook_frogsleep_devices
         (id, app_id, user_id, platform, push_token, app_version, timezone, push_enabled, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11::timestamptz)
       ON CONFLICT (app_id, user_id, push_token) DO UPDATE SET
         platform = EXCLUDED.platform,
         app_version = EXCLUDED.app_version,
         timezone = EXCLUDED.timezone,
         push_enabled = EXCLUDED.push_enabled,
         updated_at = EXCLUDED.updated_at,
         deleted_at = NULL
       RETURNING id, app_id, user_id, platform, push_token, app_version, timezone, push_enabled, created_at, updated_at, deleted_at`,
      [
        record.id,
        record.appId,
        record.userId,
        record.platform,
        record.pushToken,
        record.appVersion ?? null,
        record.timezone ?? null,
        record.pushEnabled,
        record.createdAt,
        record.updatedAt,
        record.deletedAt ?? null,
      ],
    );
    return parseDevice(result.rows[0] as QueryResultRow);
  }

  async deleteDevice(appId: string, userId: string, deviceId: string): Promise<FrogSleepDeviceRecord | undefined> {
    const result = await this.query(
      `UPDATE zook_frogsleep_devices
       SET push_enabled = FALSE, deleted_at = NOW(), updated_at = NOW()
       WHERE app_id = $1 AND user_id = $2 AND id = $3
       RETURNING id, app_id, user_id, platform, push_token, app_version, timezone, push_enabled, created_at, updated_at, deleted_at`,
      [appId, userId, deviceId],
    );
    return result.rows[0] ? parseDevice(result.rows[0]) : undefined;
  }

  async listDevices(filter: {
    appId: string;
    userId?: string;
    pushEnabled?: boolean;
    includeDeleted?: boolean;
  }): Promise<FrogSleepDeviceRecord[]> {
    const clauses = ["app_id = $1"];
    const values: unknown[] = [filter.appId];
    if (filter.userId) {
      values.push(filter.userId);
      clauses.push(`user_id = $${values.length}`);
    }
    if (typeof filter.pushEnabled === "boolean") {
      values.push(filter.pushEnabled);
      clauses.push(`push_enabled = $${values.length}`);
    }
    if (!filter.includeDeleted) {
      clauses.push("deleted_at IS NULL");
    }

    const result = await this.query(
      `SELECT id, app_id, user_id, platform, push_token, app_version, timezone, push_enabled, created_at, updated_at, deleted_at
       FROM zook_frogsleep_devices
       WHERE ${clauses.join(" AND ")}
       ORDER BY updated_at DESC`,
      values,
    );
    return result.rows.map(parseDevice);
  }

  async insertEntity(record: FrogSleepEntityRecord): Promise<void> {
    await this.query(
      `INSERT INTO ${tableFor(record.kind)}
         (id, app_id, owner_user_id, partner_user_id, relationship_id, session_id, status, code, token, starts_at, ends_at, occurred_at, payload, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12::timestamptz, $13::jsonb, $14::timestamptz, $15::timestamptz, $16::timestamptz)`,
      [
        record.id,
        record.appId,
        record.ownerUserId ?? null,
        record.partnerUserId ?? null,
        record.relationshipId ?? null,
        record.sessionId ?? null,
        record.status ?? null,
        record.code ?? null,
        record.token ?? null,
        record.startsAt ?? null,
        record.endsAt ?? null,
        record.occurredAt ?? null,
        JSON.stringify(record.payload),
        record.createdAt,
        record.updatedAt,
        record.deletedAt ?? null,
      ],
    );
  }

  async findEntity(kind: FrogSleepEntityKind, appId: string, id: string): Promise<FrogSleepEntityRecord | undefined> {
    const result = await this.query(
      `SELECT * FROM ${tableFor(kind)} WHERE app_id = $1 AND id = $2 LIMIT 1`,
      [appId, id],
    );
    return result.rows[0] ? parseEntity(kind, result.rows[0]) : undefined;
  }

  async findEntityByCode(kind: FrogSleepEntityKind, appId: string, code: string): Promise<FrogSleepEntityRecord | undefined> {
    const result = await this.query(
      `SELECT * FROM ${tableFor(kind)} WHERE app_id = $1 AND code = $2 AND deleted_at IS NULL LIMIT 1`,
      [appId, code],
    );
    return result.rows[0] ? parseEntity(kind, result.rows[0]) : undefined;
  }

  async findEntityByToken(kind: FrogSleepEntityKind, appId: string, token: string): Promise<FrogSleepEntityRecord | undefined> {
    const result = await this.query(
      `SELECT * FROM ${tableFor(kind)} WHERE app_id = $1 AND token = $2 AND deleted_at IS NULL LIMIT 1`,
      [appId, token],
    );
    return result.rows[0] ? parseEntity(kind, result.rows[0]) : undefined;
  }

  async listEntities(filter: FrogSleepEntityFilter): Promise<FrogSleepEntityRecord[]> {
    const kind = filter.kind ?? "sleep_invite";
    const clauses = ["app_id = $1"];
    const values: unknown[] = [filter.appId];
    const add = (column: string, value: unknown, operator = "=") => {
      if (value === undefined) {
        return;
      }
      values.push(value);
      clauses.push(`${column} ${operator} $${values.length}`);
    };

    add("owner_user_id", filter.ownerUserId);
    add("partner_user_id", filter.partnerUserId);
    add("relationship_id", filter.relationshipId);
    add("session_id", filter.sessionId);
    add("status", filter.status);
    add("code", filter.code);
    add("token", filter.token);
    add("starts_at", filter.startsAtFromIso, ">=");
    add("starts_at", filter.startsAtToIso, "<");
    add("occurred_at", filter.occurredAtFromIso, ">=");
    add("occurred_at", filter.occurredAtToIso, "<");
    if (!filter.includeDeleted) {
      clauses.push("deleted_at IS NULL");
    }

    const limit = Number.isFinite(filter.limit)
      ? Math.max(1, Math.min(Math.floor(filter.limit as number), 500))
      : 100;
    values.push(limit);

    const result = await this.query(
      `SELECT *
       FROM ${tableFor(kind)}
       WHERE ${clauses.join(" AND ")}
       ORDER BY COALESCE(occurred_at, starts_at, created_at) DESC
       LIMIT $${values.length}`,
      values,
    );
    return result.rows.map((row) => parseEntity(kind, row));
  }

  async updateEntity(
    kind: FrogSleepEntityKind,
    appId: string,
    id: string,
    patch: Partial<Omit<FrogSleepEntityRecord, "id" | "kind" | "appId" | "createdAt">>,
  ): Promise<FrogSleepEntityRecord | undefined> {
    const existing = await this.findEntity(kind, appId, id);
    if (!existing) {
      return undefined;
    }
    const next = {
      ...existing,
      ...patch,
      payload: patch.payload ?? existing.payload,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    };
    const result = await this.query(
      `UPDATE ${tableFor(kind)}
       SET owner_user_id = $3,
           partner_user_id = $4,
           relationship_id = $5,
           session_id = $6,
           status = $7,
           code = $8,
           token = $9,
           starts_at = $10::timestamptz,
           ends_at = $11::timestamptz,
           occurred_at = $12::timestamptz,
           payload = $13::jsonb,
           updated_at = $14::timestamptz,
           deleted_at = $15::timestamptz
       WHERE app_id = $1 AND id = $2
       RETURNING *`,
      [
        appId,
        id,
        next.ownerUserId ?? null,
        next.partnerUserId ?? null,
        next.relationshipId ?? null,
        next.sessionId ?? null,
        next.status ?? null,
        next.code ?? null,
        next.token ?? null,
        next.startsAt ?? null,
        next.endsAt ?? null,
        next.occurredAt ?? null,
        JSON.stringify(next.payload),
        next.updatedAt,
        next.deletedAt ?? null,
      ],
    );
    return result.rows[0] ? parseEntity(kind, result.rows[0]) : undefined;
  }
}
