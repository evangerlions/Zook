import { PostgresReadingScheduleStore } from "./postgres-reading-schedule-store.ts";
import { appendDomainChange } from "./postgres-domain-changes-store.ts";
import { PostgresReadingAssetsStore } from "./postgres-reading-assets-store.ts";
import { PostgresReadingPreferencesStore } from "./postgres-reading-preferences-store.ts";
import type {
  ReadingWorkRepository,
  ReadingWork,
  ReadingSource,
} from "../../../modules/lighttick/independent-reading/reading-work.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresReadingWorkStore implements ReadingWorkRepository {
  readonly schedule: PostgresReadingScheduleStore;
  readonly assets: PostgresReadingAssetsStore;
  readonly preferences: PostgresReadingPreferencesStore;
  constructor(readonly query: Query) {
    this.schedule = new PostgresReadingScheduleStore(query);
    this.assets = new PostgresReadingAssetsStore(query);
    this.preferences = new PostgresReadingPreferencesStore(query);
  }
  async source(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_sources WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as ReadingSource | undefined;
  }
  async sources(
    o: LightTickOwner,
    after: string,
    limit: number,
    includeDeleted = false,
  ) {
    return (
      await this.query(
        `SELECT payload FROM zook_lighttick_reading_sources WHERE app_id=$1 AND user_id=$2 AND id COLLATE "C">$3 AND ($5::boolean OR payload->>'deleted_at' IS NULL) ORDER BY id COLLATE "C" LIMIT $4`,
        [o.appId, o.userId, after, limit, includeDeleted],
      )
    ).rows.map((r) => r.payload as ReadingSource);
  }
  async sourceHistory(
    o: LightTickOwner,
    id: string,
    before: number,
    limit: number,
  ) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_source_versions WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision::bigint<$4::bigint ORDER BY revision DESC LIMIT $5",
        [o.appId, o.userId, id, before, limit],
      )
    ).rows.map((r) => r.payload as ReadingSource);
  }
  private async put(
    table: "sources" | "work",
    o: LightTickOwner,
    row: { id: string; revision: number },
    base: number,
  ) {
    const args = [o.appId, o.userId, row.id, row.revision, JSON.stringify(row)];
    const r =
      base === 0
        ? await this.query(
            `INSERT INTO zook_lighttick_reading_${table}(app_id,user_id,id,revision,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING id`,
            args,
          )
        : await this.query(
            `UPDATE zook_lighttick_reading_${table} SET revision=$4,payload=$5::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$6 RETURNING id`,
            [...args, base],
          );
    if (!r.rows.length) fail(409, "阅读源或任务已变化，请保留输入核对。");
    await appendDomainChange(this.query, o, {
      domain: "reading",
      resource: table === "sources" ? "source" : "work",
      id: row.id,
      revision: row.revision,
      operation: "upsert",
    });
  }
  async saveSource(o: LightTickOwner, row: ReadingSource, base: number) {
    await this.put("sources", o, row, base);
    await this.query(
      "INSERT INTO zook_lighttick_reading_source_versions(app_id,user_id,id,revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)",
      [o.appId, o.userId, row.id, row.revision, JSON.stringify(row)],
    );
  }
  async get(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_work WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as ReadingWork | undefined;
  }
  async list(o: LightTickOwner, after: string, limit: number) {
    return (
      await this.query(
        'SELECT payload FROM zook_lighttick_reading_work WHERE app_id=$1 AND user_id=$2 AND id COLLATE "C">$3 ORDER BY id COLLATE "C" LIMIT $4',
        [o.appId, o.userId, after, limit],
      )
    ).rows.map((r) => r.payload as ReadingWork);
  }
  async usage(o: LightTickOwner, since: string, now: string) {
    return (
      await this.query(
        `SELECT count(*) FILTER(WHERE payload->>'created_at'>=$3)::int AS daily,count(*) FILTER(WHERE payload->>'created_at'>=$3 AND payload->>'kind' NOT IN ('collect_url','collect_source','fetch_full','recommend'))::int AS ai_daily,count(*) FILTER(WHERE payload->>'status' IN ('queued','running'))::int AS pending,count(*) FILTER(WHERE payload->>'status'='running' AND payload->>'lease_until'>$4)::int AS running FROM zook_lighttick_reading_work WHERE app_id=$1 AND user_id=$2`,
        [o.appId, o.userId, since, now],
      )
    ).rows[0] as {
      daily: number;
      ai_daily: number;
      pending: number;
      running: number;
    };
  }
  async recent(o: LightTickOwner, since: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_work WHERE app_id=$1 AND user_id=$2 AND payload->>'created_at'>=$3",
        [o.appId, o.userId, since],
      )
    ).rows.map((r) => r.payload as ReadingWork);
  }
  async recoverable(now: string, limit: number) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_work WHERE payload->>'status'='queued' OR (payload->>'status'='running' AND payload->>'lease_until'<=$1) ORDER BY payload->>'created_at',id LIMIT $2",
        [now, limit],
      )
    ).rows.map((r) => r.payload as ReadingWork);
  }
  save(row: ReadingWork, base: number) {
    return this.put("work", row, row, base);
  }
}
