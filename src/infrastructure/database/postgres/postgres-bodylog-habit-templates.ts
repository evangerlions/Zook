import type {
  BodyLogHabitTemplateRecord,
} from "../../../modules/bodylog/bodylog-admin.types.ts";
type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;

export class PostgresBodyLogHabitTemplateStore {
  constructor(private readonly query: Query) {}

  /**
   * 列出习惯模板
   */
  async listBodyLogHabitTemplates(appId: string): Promise<BodyLogHabitTemplateRecord[]> {
    const result = await this.query(
      `SELECT * FROM zook_bodylog_habit_templates
      WHERE app_id = $1
      ORDER BY sort_order ASC, created_at ASC`,
      [appId]
    );

    return result.rows.map((row) => ({
      id: row.id as string,
      appId: row.app_id as string,
      templateKey: row.template_key as string,
      category: row.category as string,
      names: (row.names || {}) as Record<string, string>,
      icon: (row.icon as string) || null,
      defaultTargetCount: Number(row.default_target_count),
      sortOrder: Number(row.sort_order),
      status: row.status as "active" | "archived",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  /**
   * 查找习惯模板
   */
  async findBodyLogHabitTemplate(appId: string, id: string): Promise<BodyLogHabitTemplateRecord | undefined> {
    const result = await this.query(
      `SELECT * FROM zook_bodylog_habit_templates WHERE app_id = $1 AND id = $2`,
      [appId, id]
    );

    if (result.rows.length === 0) return undefined;

    const row = result.rows[0];
    return {
      id: row.id as string,
      appId: row.app_id as string,
      templateKey: row.template_key as string,
      category: row.category as string,
      names: (row.names || {}) as Record<string, string>,
      icon: (row.icon as string) || null,
      defaultTargetCount: Number(row.default_target_count),
      sortOrder: Number(row.sort_order),
      status: row.status as "active" | "archived",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  /**
   * 通过 key 查找习惯模板
   */
  async findBodyLogHabitTemplateByKey(appId: string, key: string): Promise<BodyLogHabitTemplateRecord | undefined> {
    const result = await this.query(
      `SELECT * FROM zook_bodylog_habit_templates WHERE app_id = $1 AND template_key = $2`,
      [appId, key]
    );

    if (result.rows.length === 0) return undefined;

    const row = result.rows[0];
    return {
      id: row.id as string,
      appId: row.app_id as string,
      templateKey: row.template_key as string,
      category: row.category as string,
      names: (row.names || {}) as Record<string, string>,
      icon: (row.icon as string) || null,
      defaultTargetCount: Number(row.default_target_count),
      sortOrder: Number(row.sort_order),
      status: row.status as "active" | "archived",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  /**
   * 插入习惯模板
   */
  async insertBodyLogHabitTemplate(record: BodyLogHabitTemplateRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_bodylog_habit_templates (
        id, app_id, template_key, category, names, icon,
        default_target_count, sort_order, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz)`,
      [
        record.id,
        record.appId,
        record.templateKey,
        record.category,
        JSON.stringify(record.names),
        record.icon,
        record.defaultTargetCount,
        record.sortOrder,
        record.status,
        record.createdAt,
        record.updatedAt,
      ]
    );
  }

  /**
   * 更新习惯模板
   */
  async updateBodyLogHabitTemplate(record: BodyLogHabitTemplateRecord): Promise<void> {
    await this.query(
      `UPDATE zook_bodylog_habit_templates SET
        template_key = $3,
        category = $4,
        names = $5::jsonb,
        icon = $6,
        default_target_count = $7,
        sort_order = $8,
        status = $9,
        updated_at = $10::timestamptz
      WHERE app_id = $1 AND id = $2`,
      [
        record.appId,
        record.id,
        record.templateKey,
        record.category,
        JSON.stringify(record.names),
        record.icon,
        record.defaultTargetCount,
        record.sortOrder,
        record.status,
        record.updatedAt,
      ]
    );
  }

  /**
   * 删除习惯模板
   */
  async deleteBodyLogHabitTemplate(appId: string, id: string): Promise<boolean> {
    const result = await this.query(
      `DELETE FROM zook_bodylog_habit_templates WHERE app_id = $1 AND id = $2`,
      [appId, id]
    );
    return (result.rowCount || 0) > 0;
  }
}
