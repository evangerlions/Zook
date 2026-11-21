import type { LocalGeneration, LocalGenerationRepository } from "../../../modules/lighttick/personal-model/local-generation.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type { QueryClient } from "./postgres-lighttick-owner-transaction.ts";

export class PostgresLightTickLocalGenerationStore implements LocalGenerationRepository {
  constructor(private readonly query: QueryClient["query"]) {}

  async get(owner: LightTickOwner, id: string) {
    const found = await this.query("SELECT payload FROM zook_lighttick_local_generations WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [owner.appId, owner.userId, id]);
    return found.rows[0]?.payload as LocalGeneration | undefined;
  }

  async pending(owner: LightTickOwner) {
    const found = await this.query("SELECT payload FROM zook_lighttick_local_generations WHERE app_id=$1 AND user_id=$2 AND status='prepared'",
      [owner.appId, owner.userId]);
    return found.rows.map(row => row.payload as LocalGeneration);
  }

  async save(row: LocalGeneration) {
    await this.query(`INSERT INTO zook_lighttick_local_generations (app_id,user_id,id,status,payload) VALUES ($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT (app_id,user_id,id) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload`,
      [row.appId, row.userId, row.id, row.status, JSON.stringify(row)]);
  }
}
