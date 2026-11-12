import { appendDomainChange } from "./postgres-domain-changes-store.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  ReadingBackupRepository,
  ReadingBackupSection,
  ReadingBackupRecord,
  ReadingBackupManifest,
  ReadingBackupPart,
} from "../../../modules/lighttick/reading/reading-backup.types.ts";
import { portableReadingRecord } from "../../../modules/lighttick/reading/reading-backup-record.ts";
import { mapRow } from "./postgres-lighttick-row-mappers.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
const tables: Record<
  Exclude<ReadingBackupSection, "receipts">,
  [string, string]
> = {
  articles: ["reading_articles", "id"],
  article_versions: [
    "reading_versions",
    "jsonb_build_array(id,revision)::text",
  ],
  vocabulary: ["reading_vocabulary", "id"],
  vocabulary_reviews: [
    "reading_vocabulary_reviews",
    "jsonb_build_array(id,revision)::text",
  ],
  sources: ["reading_sources", "id"],
  source_versions: [
    "reading_source_versions",
    "jsonb_build_array(id,revision)::text",
  ],
  work: ["reading_work", "id"],
  work_assets: ["reading_work_assets", "jsonb_build_array(work_id,id)::text"],
  preferences: ["reading_preferences", "'preferences'::text"],
  preference_versions: ["reading_preferences_versions", "revision::text"],
  schedule: ["reading_schedule_days", "date::text"],
};
export class PostgresReadingBackupStore implements ReadingBackupRepository {
  constructor(readonly query: Query) {}
  async expiredOwners(now: string, limit: number) {
    return (
      await this.query(
        'SELECT app_id AS "appId",user_id AS "userId" FROM zook_lighttick_reading_backups WHERE expires_at<=$1::timestamptz GROUP BY app_id,user_id ORDER BY min(expires_at),user_id COLLATE "C" LIMIT $2',
        [now, limit],
      )
    ).rows as LightTickOwner[];
  }
  async entries(
    o: LightTickOwner,
    section: ReadingBackupSection,
    after: string,
    limit: number,
  ): Promise<ReadingBackupRecord[]> {
    if (section === "receipts")
      return (
        await this.query(
          `SELECT * FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND operation_id COLLATE "C">$3 AND entity_type IN ('reading_article','reading_work','reading_vocabulary','reading_erasure') ORDER BY operation_id COLLATE "C" LIMIT $4`,
          [o.appId, o.userId, after, limit],
        )
      ).rows.map((row) =>
        portableReadingRecord(section, row.operation_id, mapRow(row)),
      );
    if (section === "articles")
      return (
        await this.query(
          `SELECT id AS key,payload FROM (SELECT id,payload FROM zook_lighttick_reading_articles WHERE app_id=$1 AND user_id=$2 UNION ALL SELECT id,payload FROM zook_lighttick_reading_tombstones WHERE app_id=$1 AND user_id=$2) AS records WHERE id COLLATE "C">$3 ORDER BY id COLLATE "C" LIMIT $4`,
          [o.appId, o.userId, after, limit],
        )
      ).rows.map((row) => portableReadingRecord(section, row.key, row.payload));
    const [table, key] = tables[section];
    return (
      await this.query(
        `SELECT ${key} AS key,payload FROM zook_lighttick_${table} WHERE app_id=$1 AND user_id=$2 AND (${key}) COLLATE "C">$3 ORDER BY (${key}) COLLATE "C" LIMIT $4`,
        [o.appId, o.userId, after, limit],
      )
    ).rows.map((row) => portableReadingRecord(section, row.key, row.payload));
  }
  async list(o: LightTickOwner) {
    return (
      await this.query(
        'SELECT payload FROM zook_lighttick_reading_backups WHERE app_id=$1 AND user_id=$2 AND payload IS NOT NULL ORDER BY id COLLATE "C"',
        [o.appId, o.userId],
      )
    ).rows.map((row) => row.payload as ReadingBackupManifest);
  }
  async get(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_backups WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as ReadingBackupManifest | undefined;
  }
  async part(o: LightTickOwner, id: string, index: number) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_backup_parts WHERE app_id=$1 AND user_id=$2 AND backup_id=$3 AND part_index=$4",
        [o.appId, o.userId, id, index],
      )
    ).rows[0]?.payload as ReadingBackupPart | undefined;
  }
  async begin(o: LightTickOwner, id: string, expires: string) {
    await this.query(
      "INSERT INTO zook_lighttick_reading_backups(app_id,user_id,id,expires_at,payload) VALUES($1,$2,$3,$4,NULL)",
      [o.appId, o.userId, id, expires],
    );
  }
  async savePart(o: LightTickOwner, id: string, part: ReadingBackupPart) {
    await this.query(
      "INSERT INTO zook_lighttick_reading_backup_parts(app_id,user_id,backup_id,part_index,payload) VALUES($1,$2,$3,$4,$5::jsonb)",
      [o.appId, o.userId, id, part.index, JSON.stringify(part)],
    );
  }
  async finish(o: LightTickOwner, manifest: ReadingBackupManifest) {
    const saved = await this.query(
      "UPDATE zook_lighttick_reading_backups SET payload=$4::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND payload IS NULL RETURNING id",
      [o.appId, o.userId, manifest.id, JSON.stringify(manifest)],
    );
    if (!saved.rows.length) fail(409, "Immutable backup conflict");
    await appendDomainChange(this.query, o, {
      domain: "reading",
      resource: "backup",
      id: manifest.id,
      revision: manifest.revision,
      operation: "upsert",
    });
  }
  async delete(o: LightTickOwner, id: string) {
    const removed = await this.query(
      "DELETE FROM zook_lighttick_reading_backups WHERE app_id=$1 AND user_id=$2 AND id=$3 RETURNING id,payload",
      [o.appId, o.userId, id],
    );
    for (const row of removed.rows)
      if (row.payload)
        await appendDomainChange(this.query, o, {
          domain: "reading",
          resource: "backup",
          id: row.id,
          revision: row.payload.revision,
          operation: "delete",
        });
  }
  async prune(o: LightTickOwner, now: string) {
    const removed = await this.query(
      "DELETE FROM zook_lighttick_reading_backups WHERE app_id=$1 AND user_id=$2 AND expires_at<=$3::timestamptz RETURNING id,payload",
      [o.appId, o.userId, now],
    );
    for (const row of removed.rows)
      if (row.payload)
        await appendDomainChange(this.query, o, {
          domain: "reading",
          resource: "backup",
          id: row.id,
          revision: row.payload.revision,
          operation: "delete",
        });
  }
  async invalidate(o: LightTickOwner) {
    const removed = await this.query(
      "DELETE FROM zook_lighttick_reading_backups WHERE app_id=$1 AND user_id=$2 RETURNING id,payload",
      [o.appId, o.userId],
    );
    for (const row of removed.rows)
      if (row.payload)
        await appendDomainChange(this.query, o, {
          domain: "reading",
          resource: "backup",
          id: row.id,
          revision: row.payload.revision,
          operation: "delete",
        });
  }
}
