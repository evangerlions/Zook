import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { badRequest } from "../../../shared/errors.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { parseIsoTimestamp } from "../frogsleep-validation.ts";
import { personalRecordId, validatePersonalRecordOwner } from "./personal-record-upload.ts";

export function buildSleepReportUpload(userId: string, input: Record<string, unknown>): FrogSleepEntityRecord {
  validatePersonalRecordOwner(input, userId);
  const snapshotId = personalRecordId(input.snapshot_id ?? input.report_id ?? input.id);
  if (!snapshotId) badRequest("REQ_INVALID_BODY", "snapshot_id is required.");
  const version = stringInput(input.schema_version ?? input.version);
  if (!version) badRequest("REQ_INVALID_BODY", "schema_version is required.");
  const recordedAt = parseIsoTimestamp(input.recorded_at ?? input.recordedAt, "recorded_at");
  const createdAt = new Date().toISOString();
  return { id: randomId("sleep_report_snapshot"), appId: FROGSLEEP_APP_ID, kind: "sleep_report_snapshot",
    ownerUserId: userId, status: "active", occurredAt: recordedAt, createdAt, updatedAt: createdAt,
    payload: { snapshot_id: snapshotId, report_id: stringInput(input.report_id) ?? snapshotId,
      schema_version: version, recorded_at: recordedAt, date_anchor: stringInput(input.date_anchor ?? input.dateAnchor),
      report_type: stringInput(input.report_type ?? input.reportType) ?? "sleep_report",
      data: reportData(input.data ?? input.report ?? {}) } };
}

function stringInput(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function reportData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    badRequest("REQ_INVALID_BODY", "data must be an object.");
  return value as Record<string, unknown>;
}
