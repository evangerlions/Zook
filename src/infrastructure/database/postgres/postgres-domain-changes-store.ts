import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import {
  domainHint,
  type Domain,
  type DomainHint,
  type DomainChange,
  type DomainChangesRepository,
} from "../../../modules/lighttick/domain-changes/domain-changes.types.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export async function appendDomainChange(
  query: Query,
  o: LightTickOwner,
  raw: DomainHint,
) {
  const hint = domainHint(raw);
  await query(
    `INSERT INTO zook_lighttick_change_log(app_id,user_id,entity_type,entity_id,entity_version,operation,snapshot,changed_at)
  VALUES($1,$2,'domain',$3,$4,$5,$6::jsonb,clock_timestamp())
  ON CONFLICT(app_id,user_id,entity_id,entity_version,operation) WHERE entity_type='domain' DO NOTHING`,
    [
      o.appId,
      o.userId,
      JSON.stringify([hint.domain, hint.resource, hint.id]),
      hint.revision,
      hint.operation,
      JSON.stringify(hint),
    ],
  );
}
export class PostgresDomainChangesStore implements DomainChangesRepository {
  constructor(readonly query: Query) {}
  append = (o: LightTickOwner, hint: DomainHint) =>
    appendDomainChange(this.query, o, hint);
  async head(o: LightTickOwner, domain: Domain | null) {
    const row = (
      await this.query(
        `SELECT c.sequence::text AS sequence FROM zook_lighttick_change_log c WHERE c.app_id=$1 AND c.user_id=$2 AND c.entity_type='domain'
    ${domain === null ? "" : "AND c.snapshot->>'domain'=$3"} ORDER BY c.sequence DESC LIMIT 1`,
        domain === null ? [o.appId, o.userId] : [o.appId, o.userId, domain],
      )
    ).rows[0];
    return row?.sequence ?? "0";
  }
  async page(
    o: LightTickOwner,
    domain: Domain | null,
    after: string,
    limit: number,
  ): Promise<DomainChange[]> {
    const rows = (
      await this.query(
        `SELECT c.sequence::text AS sequence,c.snapshot,c.changed_at FROM zook_lighttick_change_log c
    WHERE c.app_id=$1 AND c.user_id=$2 AND c.entity_type='domain' AND c.sequence>$3::bigint
    ${domain === null ? "" : "AND c.snapshot->>'domain'=$5"} ORDER BY c.sequence ASC LIMIT $4`,
        domain === null
          ? [o.appId, o.userId, after, limit]
          : [o.appId, o.userId, after, limit, domain],
      )
    ).rows;
    return rows.map((r) => ({
      ...domainHint(r.snapshot),
      sequence: r.sequence,
      notified_at: new Date(r.changed_at).toISOString(),
    }));
  }
}
