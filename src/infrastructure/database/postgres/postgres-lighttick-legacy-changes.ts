import type {
  LightTickOwner,
  LightTickChangeRow,
} from "../../../modules/lighttick/lighttick.types.ts";
import { mapRow } from "./postgres-lighttick-row-mappers.ts";
export async function legacyLightTickChanges(
  query: (
    sql: string,
    args: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>,
  owner: LightTickOwner,
  after: number,
  limit: number,
): Promise<LightTickChangeRow[]> {
  const result = await query(
    `SELECT * FROM zook_lighttick_change_log WHERE app_id=$1 AND user_id=$2
 AND entity_type<>'domain' AND sequence>$3 ORDER BY sequence ASC LIMIT $4`,
    [owner.appId, owner.userId, after, limit],
  );
  return result.rows.map(row => {
    const sequence = Number(row.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Invalid stored LightTick sequence");
    return mapRow<LightTickChangeRow>({ ...row, sequence });
  });
}
