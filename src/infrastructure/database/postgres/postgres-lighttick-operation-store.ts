import type {
  LightTickOwner,
  LightTickOperationRow,
} from "../../../modules/lighttick/lighttick.types.ts";
import { mapRow } from "./postgres-lighttick-row-mappers.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;
export class PostgresLightTickOperationStore {
  constructor(readonly query: Query) {}
  async get(
    owner: LightTickOwner,
    operationId: string,
  ): Promise<LightTickOperationRow | undefined> {
    const result = await this.query(
      "SELECT * FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND operation_id=$3",
      [owner.appId, owner.userId, operationId],
    );
    return result.rows[0]
      ? mapRow<LightTickOperationRow>(result.rows[0])
      : undefined;
  }
  async save(row: LightTickOperationRow): Promise<LightTickOperationRow> {
    const result = await this.query(
      `INSERT INTO zook_lighttick_operations
 (app_id,user_id,operation_id,device_id,payload_hash,entity_type,entity_id,action,request_payload,result_payload,status,created_at,updated_at)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13)
 ON CONFLICT (app_id,user_id,operation_id) DO NOTHING RETURNING *`,
      [
        row.appId,
        row.userId,
        row.operationId,
        row.deviceId,
        row.payloadHash,
        row.entityType,
        row.entityId,
        row.action,
        JSON.stringify(row.requestPayload),
        JSON.stringify(row.resultPayload),
        row.status,
        row.createdAt,
        row.updatedAt,
      ],
    );
    return result.rows[0]
      ? mapRow<LightTickOperationRow>(result.rows[0])
      : (await this.get(row, row.operationId))!;
  }
}
