import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { badRequest } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import {
  paginateRecords,
  parseIsoTimestamp,
  type PaginationParams,
} from "../frogsleep-validation.ts";

const PROGRESS_NAMESPACES = new Set([
  "habit_progress",
  "companion_state",
  "cat_state",
  "onboarding",
  "report_preferences",
]);
const ENTITLEMENT_STATES = new Set(["active", "expired", "revoked", "unknown", "free"]);

function nowIso(): string {
  return new Date().toISOString();
}

function stringInput(input: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function requiredRecord(value: unknown, fieldName: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    badRequest("REQ_INVALID_BODY", `${fieldName} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export class FrogSleepProductDataService {
  constructor(private readonly database: ApplicationDatabase) {}

  async createSleepReport(userId: string, input: Record<string, unknown>) {
    const snapshotId = stringInput(input, "snapshot_id", "report_id", "id");
    if (!snapshotId) {
      badRequest("REQ_INVALID_BODY", "snapshot_id is required.");
    }
    const version = stringInput(input, "schema_version", "version");
    if (!version) {
      badRequest("REQ_INVALID_BODY", "schema_version is required.");
    }
    const recordedAt = parseIsoTimestamp(input.recorded_at ?? input.recordedAt, "recorded_at");
    const payload = {
      snapshot_id: snapshotId,
      report_id: stringInput(input, "report_id") ?? snapshotId,
      schema_version: version,
      recorded_at: recordedAt,
      date_anchor: stringInput(input, "date_anchor", "dateAnchor"),
      report_type: stringInput(input, "report_type", "reportType") ?? "sleep_report",
      data: requiredRecord(input.data ?? input.report ?? {}, "data"),
    };
    const createdAt = nowIso();
    const record: FrogSleepEntityRecord = {
      id: randomId("sleep_report_snapshot"),
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_report_snapshot",
      ownerUserId: userId,
      status: "active",
      occurredAt: recordedAt,
      payload,
      createdAt,
      updatedAt: createdAt,
    };
    await this.database.insertFrogSleepEntity(record);
    return this.toSleepReport(record);
  }

  async listSleepReports(userId: string, pagination?: PaginationParams) {
    const records = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_report_snapshot",
      ownerUserId: userId,
      limit: 500,
    });
    const page = paginateRecords(records, pagination ?? { limit: 50 });
    return {
      sleep_reports: page.items.map((item) => this.toSleepReport(item)),
      reports: page.items.map((item) => this.toSleepReport(item)),
      pagination: page.pagination,
    };
  }

  async upsertProgress(userId: string, namespace: string, input: Record<string, unknown>) {
    this.assertProgressNamespace(namespace);
    const version = stringInput(input, "schema_version", "version");
    if (!version) {
      badRequest("REQ_INVALID_BODY", "schema_version is required.");
    }
    const state = requiredRecord(input.state ?? input.data, "state");
    const existing = await this.findProgress(userId, namespace);
    const payload = {
      namespace,
      schema_version: version,
      state,
    };
    if (existing) {
      const updated = await this.database.updateFrogSleepEntity("progress_snapshot", FROGSLEEP_APP_ID, existing.id, {
        status: "active",
        payload,
      });
      return this.toProgress(updated as FrogSleepEntityRecord);
    }
    const createdAt = nowIso();
    const record: FrogSleepEntityRecord = {
      id: randomId("progress_snapshot"),
      appId: FROGSLEEP_APP_ID,
      kind: "progress_snapshot",
      ownerUserId: userId,
      status: "active",
      payload,
      createdAt,
      updatedAt: createdAt,
    };
    await this.database.insertFrogSleepEntity(record);
    return this.toProgress(record);
  }

  async getProgress(userId: string, namespace: string) {
    this.assertProgressNamespace(namespace);
    const record = await this.findProgress(userId, namespace);
    return record ? this.toProgress(record) : null;
  }

  async currentEntitlement(userId: string) {
    const record = (await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "entitlement_record",
      ownerUserId: userId,
      limit: 1,
    }))[0];
    return record ? this.toEntitlement(record) : {
      state: "unknown",
      plan: "free",
      source: "none",
    };
  }

  async upsertEntitlement(userId: string, input: Record<string, unknown>) {
    const state = stringInput(input, "state") ?? "unknown";
    if (!ENTITLEMENT_STATES.has(state)) {
      badRequest("REQ_INVALID_BODY", "state is invalid.");
    }
    const payload = {
      state,
      plan: stringInput(input, "plan") ?? "free",
      source: stringInput(input, "source") ?? "internal",
      verified_at: parseIsoTimestamp(input.verified_at ?? input.verifiedAt ?? nowIso(), "verified_at"),
      expires_at: input.expires_at ? parseIsoTimestamp(input.expires_at, "expires_at") : undefined,
    };
    const existing = (await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "entitlement_record",
      ownerUserId: userId,
      limit: 1,
    }))[0];
    if (existing) {
      const updated = await this.database.updateFrogSleepEntity("entitlement_record", FROGSLEEP_APP_ID, existing.id, {
        status: state,
        payload,
      });
      return this.toEntitlement(updated as FrogSleepEntityRecord);
    }
    const createdAt = nowIso();
    const record: FrogSleepEntityRecord = {
      id: randomId("entitlement_record"),
      appId: FROGSLEEP_APP_ID,
      kind: "entitlement_record",
      ownerUserId: userId,
      status: state,
      payload,
      createdAt,
      updatedAt: createdAt,
    };
    await this.database.insertFrogSleepEntity(record);
    return this.toEntitlement(record);
  }

  private async findProgress(userId: string, namespace: string) {
    const records = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "progress_snapshot",
      ownerUserId: userId,
      status: "active",
      limit: 100,
    });
    return records.find((item) => item.payload.namespace === namespace);
  }

  private assertProgressNamespace(namespace: string) {
    if (!PROGRESS_NAMESPACES.has(namespace)) {
      badRequest("REQ_INVALID_BODY", "Unsupported progress namespace.");
    }
  }

  private toSleepReport(record: FrogSleepEntityRecord) {
    const { data, ...payload } = record.payload;
    return {
      id: record.id,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      ...payload,
      snapshot_data: data,
    };
  }

  private toProgress(record: FrogSleepEntityRecord) {
    return {
      id: record.id,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      ...record.payload,
    };
  }

  private toEntitlement(record: FrogSleepEntityRecord) {
    return {
      id: record.id,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      ...record.payload,
    };
  }
}
