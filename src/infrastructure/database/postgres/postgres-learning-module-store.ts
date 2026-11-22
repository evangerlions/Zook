import type { LearningModule, LearningModuleRepository } from "../../../modules/lighttick/learning/learning-module.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { mapRow } from "./postgres-lighttick-row-mappers.ts";

type Query = (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, any>[] }>;

export class PostgresLearningModuleStore implements LearningModuleRepository {
  constructor(readonly query: Query) {}

  async history(owner: LightTickOwner, id: string, before: number, limit: number) {
    const result = await this.query(
      "SELECT payload FROM zook_lighttick_learning_module_versions WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision::bigint<$4::bigint ORDER BY revision DESC LIMIT $5",
      [owner.appId, owner.userId, id, before, limit],
    );
    return result.rows.map(row => row.payload as LearningModule);
  }

  async get(owner: LightTickOwner, id: string) {
    const result = await this.query(
      "SELECT *,NOT enabled AS archived FROM zook_lighttick_learning_modules WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [owner.appId, owner.userId, id],
    );
    return result.rows[0] ? mapRow<LearningModule>(result.rows[0]) : undefined;
  }

  async list(owner: LightTickOwner, after: string, limit: number, filter: "active" | "archived" | "all") {
    const result = await this.query(
      `SELECT *,NOT enabled AS archived FROM zook_lighttick_learning_modules
       WHERE app_id=$1 AND user_id=$2 AND id LIKE 'module-%' AND id COLLATE "C">$3 AND ($4='all' OR enabled=$5)
       ORDER BY id COLLATE "C" LIMIT $6`,
      [owner.appId, owner.userId, after, filter, filter === "active", limit],
    );
    return result.rows.map(row => mapRow<LearningModule>(row));
  }

  async save(row: LearningModule, base: number) {
    const values = [row.appId, row.userId, row.id, row.revision, row.title, row.description, !row.archived,
      row.templateId, row.createdAt, row.updatedAt];
    const result = base === 0
      ? await this.query(
        `INSERT INTO zook_lighttick_learning_modules(app_id,user_id,id,revision,title,description,enabled,template_id,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id`, values)
      : await this.query(
        `UPDATE zook_lighttick_learning_modules SET revision=$4,title=$5,description=$6,enabled=$7,template_id=$8,updated_at=$9
         WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$10 RETURNING id`, [...values.slice(0, 8), row.updatedAt, base]);
    if (!result.rows.length) throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "模块已变化，请保留本机输入并核对。");
    await this.query(
      "INSERT INTO zook_lighttick_learning_module_versions(app_id,user_id,id,revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)",
      [row.appId, row.userId, row.id, row.revision, JSON.stringify(row)],
    );
  }
}
