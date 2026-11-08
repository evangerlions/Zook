import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import {
  materialSummary,
  type Material,
  type MaterialRepository,
  type MaterialReference,
} from "../../../modules/lighttick/investments/materials/material.types.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresMaterialStore implements MaterialRepository {
  constructor(readonly query: Query) {}
  async get(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_investment_materials WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as Material | undefined;
  }
  async version(o: LightTickOwner, id: string, revision: number) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_investment_material_versions WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$4",
        [o.appId, o.userId, id, revision],
      )
    ).rows[0]?.payload as Material | undefined;
  }
  async list(o: LightTickOwner) {
    return (
      await this.query(
        `SELECT payload - ARRAY['content','locator','source_url','contrary_evidence'] AS payload FROM zook_lighttick_investment_materials WHERE app_id=$1 AND user_id=$2 ORDER BY id COLLATE "C" LIMIT 501`,
        [o.appId, o.userId],
      )
    ).rows.map((r) => materialSummary(r.payload));
  }
  async versions(o: LightTickOwner, id: string, before: number, limit: number) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_investment_material_versions WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision<$4 ORDER BY revision DESC LIMIT $5",
        [o.appId, o.userId, id, before, limit],
      )
    ).rows.map((r) => r.payload as Material);
  }
  async references(
    o: LightTickOwner,
    id: string,
  ): Promise<MaterialReference[]> {
    return (
      await this.query(
        `SELECT r.id AS research_id,r.revision AS research_revision,r.instrument_id,r.payload->>'title' AS title,(r.payload->>'archived')::boolean AS archived,(s->>'version')::integer AS material_version FROM zook_lighttick_investment_research r CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.payload->'material_sources','[]'::jsonb)) s WHERE r.app_id=$1 AND r.user_id=$2 AND s->>'id'=$3 ORDER BY r.id COLLATE "C" LIMIT 501`,
        [o.appId, o.userId, id],
      )
    ).rows as MaterialReference[];
  }
  async save(o: LightTickOwner, m: Material, base: number) {
    const args = [o.appId, o.userId, m.id, m.revision, JSON.stringify(m)];
    const r =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_investment_materials VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING id",
            args,
          )
        : await this.query(
            "UPDATE zook_lighttick_investment_materials SET revision=$4,payload=$5::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$6 RETURNING id",
            [...args, base],
          );
    if (!r.rows.length) fail(409, "Material changed; retain original request.");
    await this.query(
      "INSERT INTO zook_lighttick_investment_material_versions VALUES($1,$2,$3,$4,$5::jsonb)",
      args,
    );
  }
}
