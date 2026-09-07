import type { FeatureFlagRecord } from "../../../modules/bodylog/bodylog-feature-flag.types.ts";

export class PostgresBodyLogFeatureFlagStore {
  constructor(private readonly query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>) {}

  async listFlags(): Promise<FeatureFlagRecord[]> {
    const result = await this.query(`SELECT * FROM bodylog_feature_flags ORDER BY key ASC`);
    return result.rows.map((row: any) => this.mapRecord(row));
  }

  async findFlag(key: string): Promise<FeatureFlagRecord | null> {
    const result = await this.query(`SELECT * FROM bodylog_feature_flags WHERE key = $1`, [key]);
    return result.rows[0] ? this.mapRecord(result.rows[0]) : null;
  }

  async updateFlag(key: string, enabled: boolean): Promise<FeatureFlagRecord> {
    const result = await this.query(
      `UPDATE bodylog_feature_flags SET enabled = $2, updated_at = NOW() WHERE key = $1 RETURNING *`,
      [key, enabled],
    );
    if (!result.rows[0]) {
      throw new Error(`feature flag not found: ${key}`);
    }
    return this.mapRecord(result.rows[0]);
  }

  private mapRecord(row: any): FeatureFlagRecord {
    return {
      id: row.id,
      key: row.key,
      enabled: row.enabled,
      description: row.description ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
