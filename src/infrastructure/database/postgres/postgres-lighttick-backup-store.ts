import { createHash } from "node:crypto";
import { LIGHTTICK_OWNED_TABLES } from "./postgres-lighttick-owned-tables.ts";
import type {
  BackupStore,
  BackupSnapshot,
  BackupEntry,
  Tables,
} from "../../../modules/lighttick/backup/backup.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { QueryClient } from "./postgres-lighttick-owner-transaction.ts";
export const BACKUP_EXCLUDED = [
  "registration_invitations", "invitation_claims", "trial_participation",
  "account_backups",
  "personal_model",
  "model_tests",
  "github_settings",
  "github_tests",
  "devices",
  "guest_identities",
  "user_storage",
  "user_subscriptions",
  "operations",
  "sync_cursors",
  "change_log",
  "api_usage_logs",
  "record_tickets",
  "record_transfers",
  "action_tickets",
  "action_links",
  "content_publications",
  "module_sources",
  "module_subscriptions",
  "learning_authorities",
] as const;
export const BACKUP_TABLES = LIGHTTICK_OWNED_TABLES.filter(
  (t) => !(BACKUP_EXCLUDED as readonly string[]).includes(t),
);
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  );
export class PostgresLightTickBackupStore implements BackupStore {
  constructor(private readonly query: QueryClient["query"]) {}
  private async columns() {
    return (
      await this.query(
        "SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'zook_lighttick_%' ORDER BY table_name,ordinal_position",
      )
    ).rows;
  }
  async capture(o: LightTickOwner): Promise<BackupSnapshot> {
    const columns = await this.columns();
    const ownerTables = columns
      .filter((c) => c.column_name === "user_id")
      .map((c) => String(c.table_name).replace("zook_lighttick_", ""));
    if (
      ownerTables.some(
        (t) =>
          ![
            ...LIGHTTICK_OWNED_TABLES,
            "payment_orders",
            "local_claims",
          ].includes(t as any),
      )
    )
      throw new ApplicationError(
        503,
        "LIGHTTICK_BACKUP_SCOPE_UNSUPPORTED",
        "存在尚未登记备份范围的数据表。",
      );
    const schema = createHash("sha256")
      .update("pg-lossless-v1")
      .update(
        canonical(
          columns.filter((c) =>
            BACKUP_TABLES.includes(
              String(c.table_name).replace("zook_lighttick_", "") as any,
            ),
          ),
        ),
      )
      .digest("hex");
    const tables: Tables = {};
    let count = 0;
    for (const name of BACKUP_TABLES) {
      const encoded = columns
        .filter(
          (c) =>
            c.table_name === "zook_lighttick_" + name &&
            ["jsonb", "json", "numeric", "bigint"].includes(
              String(c.data_type),
            ),
        )
        .map((c) => {
          const k = String(c.column_name);
          if (!/^[a-z_]+$/.test(k))
            throw new Error("Unsupported backup column");
          return (
            `'${k}', ` +
            (["jsonb", "json"].includes(String(c.data_type))
              ? `CASE WHEN t."${k}" IS NULL THEN NULL ELSE jsonb_build_object('$lighttick_json',t."${k}"::text) END`
              : `t."${k}"::text`)
          );
        });
      const rows = (
        await this.query(
          `SELECT to_jsonb(t) ${encoded.length ? "|| jsonb_build_object(" + encoded.join(",") + ")" : ""} AS row FROM zook_lighttick_${name} t WHERE app_id=$1 AND user_id=$2 ORDER BY to_jsonb(t)::text LIMIT 10001`,
          [o.appId, o.userId],
        )
      ).rows.map((r) => r.row as Record<string, any>);
      count += rows.length;
      if (rows.length > 10000 || count > 50000)
        throw new ApplicationError(
          413,
          "LIGHTTICK_BACKUP_TOO_LARGE",
          "账户数据超过当前备份容量，未生成部分备份。",
        );
      tables[name] = rows;
    }
    return { schema, tables };
  }
  async busy(o: LightTickOwner) {
    for (const t of [
      ...BACKUP_TABLES.filter(
        (t) =>
          t.endsWith("_work") ||
          [
            "learning_work",
            "account_reports",
            "research_ai",
            "ai_runs",
            "focus_sessions",
          ].includes(t),
      ),
      "content_publications",
    ]) {
      const field = t === "content_publications" ? "state" : "status";
      const r = await this.query(
        `SELECT 1 FROM zook_lighttick_${t} WHERE app_id=$1 AND user_id=$2 AND ${field}=ANY($3::text[]) LIMIT 1`,
        [
          o.appId,
          o.userId,
          [
            "queued",
            "running",
            "generating",
            "pending",
            "processing",
            "prepared",
            "publishing",
            "applying",
            "active",
            "paused",
          ],
        ],
      );
      if (r.rows.length) return true;
    }
    return false;
  }
  async replace(o: LightTickOwner, input: Tables) {
    const current = await this.capture(o);
    const prior = await this.query(
      `SELECT COALESCE(MAX(n),0)::text AS floor FROM (SELECT CASE WHEN jsonb_typeof(result_payload->k)='number' THEN (result_payload->>k)::numeric ELSE 0 END AS n FROM zook_lighttick_operations CROSS JOIN unnest(ARRAY['version_floor','version','revision','notes_revision','position_revision','completion_revision']) k WHERE app_id=$1 AND user_id=$2) versions`,
      [o.appId, o.userId],
    );
    let versionFloor = Number(prior.rows[0]?.floor ?? 0);
    for (const snapshot of [current.tables, input])
      for (const table of Object.values(snapshot))
        for (const row of table)
          for (const [k, v] of Object.entries(row))
            if (
              [
                "version",
                "revision",
                "aggregate_version",
                "epoch",
                "notes_revision",
                "position_revision",
                "completion_revision",
              ].includes(k)
            )
              versionFloor = Math.max(versionFloor, Number(v ?? 0));
    versionFloor++;
    if (!Number.isSafeInteger(versionFloor) || versionFloor > 2147483647)
      throw new ApplicationError(
        409,
        "LIGHTTICK_BACKUP_REJECTED",
        "当前版本计数需要升级数据结构后才能恢复。",
      );
    const rows = structuredClone(input);
    if (Object.keys(rows).sort().join() !== [...BACKUP_TABLES].sort().join())
      throw new ApplicationError(422, "REQ_INVALID_BODY", "备份范围不完整。");
    const cols = await this.columns();
    await this.query("SET CONSTRAINTS ALL DEFERRED");
    // Public modules can have other subscribers; account restoration must not mutate their source.
    if (
      (current.tables.learning_modules ?? []).some(
        (r) => r.is_public || Number(r.subscriber_count) > 0,
      ) ||
      (
        await this.query(
          "SELECT 1 FROM zook_lighttick_module_subscriptions WHERE app_id=$1 AND owner_id=$2 AND user_id<>$2 LIMIT 1",
          [o.appId, o.userId],
        )
      ).rows.length
    )
      throw new ApplicationError(
        409,
        "LIGHTTICK_BACKUP_SHARED_CONTENT",
        "请先处理共享模块及订阅者后再恢复账户内容。",
      );
    for (const t of BACKUP_TABLES) {
      const existing = current.tables[t];
      if (t === "learning_modules")
        for (const r of rows[t]) {
          const old = existing.find((x) => x.id === r.id);
          r.source_config = old?.source_config ?? null;
          r.storage_config = old?.storage_config ?? null;
          r.is_public = false;
          r.subscriber_count = 0;
          r.source_type = old?.source_type ?? "manual";
          r.source_url = old?.source_url ?? null;
          r.source_path = old?.source_path ?? null;
        }
      const versioned =
        !/(?:versions|publications|history)$/.test(t) &&
        ![
          "investment_events",
          "investment_baselines",
          "investment_openings",
          "execution_events",
        ].includes(t);
      const versionCols = cols
        .filter(
          (c) =>
            c.table_name === "zook_lighttick_" + t &&
            [
              "version",
              "revision",
              "epoch",
              "notes_revision",
              "position_revision",
              "completion_revision",
            ].includes(String(c.column_name)),
        )
        .map((c) => String(c.column_name));
      for (const r of rows[t]) {
        if (r.app_id !== o.appId || r.user_id !== o.userId)
          throw new ApplicationError(
            403,
            "LIGHTTICK_BACKUP_REJECTED",
            "备份所属账户不匹配。",
          );
        if (versioned)
          for (const c of versionCols) {
            const next = versionFloor;
            r[c] = next;
            for (const data of [r.payload, r.data])
              if (
                data &&
                typeof data === "object" &&
                typeof data[c] === "number"
              )
                data[c] = next;
          }
      }
    }
    for (const t of BACKUP_TABLES)
      await this.query(
        `DELETE FROM zook_lighttick_${t} WHERE app_id=$1 AND user_id=$2`,
        [o.appId, o.userId],
      );
    for (const t of [...BACKUP_TABLES].reverse()) {
      if (!rows[t].length) continue;
      const jsonCols = cols.filter(
        (c) =>
          c.table_name === "zook_lighttick_" + t &&
          ["jsonb", "json"].includes(String(c.data_type)),
      );
      const encoded = jsonCols.map((c) => {
        const k = String(c.column_name);
        if (!/^[a-z_]+$/.test(k)) throw new Error("Unsupported backup column");
        let value = `(e.value->'${k}'->>'$lighttick_json')::jsonb`;
        if (
          !/(?:versions|publications|history)$/.test(t) &&
          ![
            "investment_events",
            "investment_baselines",
            "investment_openings",
            "execution_events",
          ].includes(t)
        )
          for (const v of [
            "version",
            "revision",
            "epoch",
            "notes_revision",
            "position_revision",
            "completion_revision",
          ])
            if (rows[t][0][v] !== undefined)
              value = `CASE WHEN jsonb_typeof((${value})->'${v}')='number' THEN jsonb_set((${value}),'{${v}}',e.value->'${v}') ELSE (${value}) END`;
        return `'${k}',(${value})`;
      });
      await this.query(
        `INSERT INTO zook_lighttick_${t} SELECT p.* FROM jsonb_array_elements($1::jsonb) e CROSS JOIN LATERAL jsonb_populate_record(NULL::zook_lighttick_${t},e.value ${encoded.length ? "|| jsonb_build_object(" + encoded.join(",") + ")" : ""}) p`,
        [JSON.stringify(rows[t])],
      );
    }
    for (const [table, type] of [
      ["goals", "goal"],
      ["plan_cycles", "plan"],
      ["tasks", "task"],
    ] as const) {
      for (const old of current.tables[table])
        if (!rows[table].some((r) => r.id === old.id))
          await this.change(o, type, old.id, Number(old.version) + 1, "delete");
      for (const r of rows[table])
        await this.change(o, type, r.id, r.version, "upsert", {
          id: r.id,
          status: r.status,
          version: r.version,
        });
    }
    await this.query("SET CONSTRAINTS ALL IMMEDIATE");
    return versionFloor;
  }
  private async change(
    o: LightTickOwner,
    t: string,
    id: string,
    v: number,
    operation: string,
    snapshot?: unknown,
  ) {
    await this.query(
      "INSERT INTO zook_lighttick_change_log(app_id,user_id,entity_type,entity_id,entity_version,operation,snapshot,changed_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,CURRENT_TIMESTAMP)",
      [
        o.appId,
        o.userId,
        t,
        id,
        v,
        operation,
        JSON.stringify(snapshot ?? null),
      ],
    );
  }
  async dryRun(o: LightTickOwner, tables: Tables, check: () => Promise<void>) {
    await this.query("SAVEPOINT lighttick_backup_preflight");
    try {
      await this.replace(o, tables);
      await check();
    } finally {
      await this.query("ROLLBACK TO SAVEPOINT lighttick_backup_preflight");
      await this.query("RELEASE SAVEPOINT lighttick_backup_preflight");
    }
  }
  async list(o: LightTickOwner) {
    return (
      await this.query(
        'SELECT app_id AS "appId",user_id AS "userId",id,kind,created_at AS "createdAt",summary FROM zook_lighttick_account_backups WHERE app_id=$1 AND user_id=$2 ORDER BY created_at DESC',
        [o.appId, o.userId],
      )
    ).rows as unknown as Omit<BackupEntry, "data">[];
  }
  async get(o: LightTickOwner, id: string) {
    return (
      await this.query(
        'SELECT app_id AS "appId",user_id AS "userId",id,kind,created_at AS "createdAt",data,summary FROM zook_lighttick_account_backups WHERE app_id=$1 AND user_id=$2 AND id=$3',
        [o.appId, o.userId, id],
      )
    ).rows[0] as unknown as BackupEntry | undefined;
  }
  async put(e: BackupEntry) {
    if ((await this.list(e)).length >= 10)
      throw new ApplicationError(
        409,
        "LIGHTTICK_BACKUP_CAPACITY",
        "最多保留10份备份或预检，请下载并删除不再需要的副本。",
      );
    await this.query(
      "INSERT INTO zook_lighttick_account_backups VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)",
      [
        e.appId,
        e.userId,
        e.id,
        e.kind,
        e.createdAt,
        JSON.stringify(e.data),
        JSON.stringify(e.summary),
      ],
    );
  }
  async remove(o: LightTickOwner, id: string) {
    await this.query(
      "DELETE FROM zook_lighttick_account_backups WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [o.appId, o.userId, id],
    );
  }
}
