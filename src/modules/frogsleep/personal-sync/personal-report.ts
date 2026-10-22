import type { PersonalVersion } from "./personal-sync.types.ts";
import { parseIsoTimestamp } from "../frogsleep-validation.ts";
export function sleepReportDocument(version: PersonalVersion & { sync_epoch?: string }) {
  const { data, ...fields } = version.data;
  return { ...fields, id: version.id, created_at: version.created_at, updated_at: version.updated_at,
    revision: version.revision, sequence: version.sequence, sync_epoch: version.sync_epoch, snapshot_data: data };
}
export function reportPayload(body: Record<string, unknown>) {
  return { snapshot_id: body.snapshot_id ?? body.report_id ?? body.id,
    report_id: body.report_id ?? body.snapshot_id ?? body.id,
    schema_version: body.schema_version ?? body.version,
    recorded_at: parseIsoTimestamp(body.recorded_at ?? body.recordedAt, "recorded_at"),
    date_anchor: body.date_anchor ?? body.dateAnchor ?? null,
    report_type: body.report_type ?? body.reportType ?? "sleep_report", data: body.data ?? body.report };
}
