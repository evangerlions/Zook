import type {
  ReadingBackupRecord,
  ReadingBackupSection,
} from "./reading-backup.types.ts";
/** Preserve exact portable facts; database/request execution ownership is not replay permission. */
export function portableReadingRecord(
  section: ReadingBackupSection,
  key: string,
  raw: unknown,
): ReadingBackupRecord {
  let value = raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const { appId: _, userId: __, ...fields } = raw as Record<string, unknown>;
    value = fields;
    if (section === "work") {
      const { fence: ___, lease_until: ____, ...portable } = fields;
      value = portable;
    }
  }
  return { section, key, value: JSON.parse(JSON.stringify(value)) };
}
