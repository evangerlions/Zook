import type {
  FormRecordsRepository,
  FormSnapshot,
} from "../../../modules/lighttick/form-records/form-records.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresFormRecordsStore implements FormRecordsRepository {
  constructor(readonly query: Query) {}
  async get(o: LightTickOwner) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_form_records WHERE app_id=$1 AND user_id=$2",
        [o.appId, o.userId],
      )
    ).rows[0]?.payload as FormSnapshot | undefined;
  }
  async save(o: LightTickOwner, s: FormSnapshot, base: number) {
    const args = [o.appId, o.userId, s.revision, JSON.stringify(s)];
    const result =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_form_records(app_id,user_id,revision,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING user_id",
            args,
          )
        : await this.query(
            "UPDATE zook_lighttick_form_records SET revision=$3,payload=$4::jsonb WHERE app_id=$1 AND user_id=$2 AND revision=$5 RETURNING user_id",
            [...args, base],
          );
    if (!result.rows.length)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Form records changed.",
      );
  }
}
