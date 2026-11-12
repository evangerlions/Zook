import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type { ExperienceQuery } from "../../../modules/lighttick/experience/experience.types.ts";
import { defaultErrorTypes } from "../../../modules/lighttick/experience/experience-catalog.ts";
export const EXPERIENCE_OBJECTS = `(SELECT r.app_id,r.user_id,r.kind,r.id,r.revision,r.payload FROM zook_lighttick_experience r
 UNION ALL SELECT $1::text,$2::text,'error_type',v->>'id',0,v FROM jsonb_array_elements($3::jsonb) v
 WHERE NOT EXISTS(SELECT 1 FROM zook_lighttick_experience x WHERE x.app_id=$1 AND x.user_id=$2 AND x.kind='error_type' AND x.id=v->>'id')
 AND NOT EXISTS(SELECT 1 FROM zook_lighttick_experience_tombstones x WHERE x.app_id=$1 AND x.user_id=$2 AND x.kind='error_type' AND x.id=v->>'id')) r`;
export function experienceWhere(
  o: LightTickOwner,
  q: ExperienceQuery,
  dates = true,
) {
  const args: unknown[] = [
      o.appId,
      o.userId,
      JSON.stringify(q.kind === "error_type" ? defaultErrorTypes : []),
    ],
    conditions = ["r.app_id=$1", "r.user_id=$2"];
  const bind = (v: unknown) => {
    args.push(v);
    return "$" + args.length;
  };
  conditions.push("r.kind=" + bind(q.kind));
  if (q.archived !== "all")
    conditions.push(
      "(r.payload->>'archived')::boolean=" + bind(q.archived === "archived"),
    );
  if (dates && q.date_from)
    conditions.push("r.payload->'data'->>'date'>=" + bind(q.date_from));
  if (dates && q.date_to)
    conditions.push("r.payload->'data'->>'date'<=" + bind(q.date_to));
  if (q.module_id)
    conditions.push("r.payload->'data'->>'module_id'=" + bind(q.module_id));
  if (q.error_type)
    conditions.push("r.payload->'data'->>'error_type'=" + bind(q.error_type));
  if (q.is_repeat !== null)
    conditions.push(
      "(r.payload->'data'->>'is_repeat')::boolean=" + bind(q.is_repeat),
    );
  if (q.search)
    conditions.push(
      "strpos(lower(concat_ws(E'\\n',r.payload->'data'->>'concept',r.payload->'data'->>'scenario',r.payload->'data'->>'error_type',r.payload->'data'->>'description',r.payload->'data'->>'context',r.payload->'data'->>'improvement_action',r.payload->'data'->>'name')),lower(" +
        bind(q.search) +
        "))>0",
    );
  return { args, conditions, bind, where: () => conditions.join(" AND ") };
}
export const EXPERIENCE_SUMMARY_SQL = `jsonb_build_object('id',r.id,'kind',r.kind,'revision',r.revision,'archived',r.payload->'archived',
 'date',r.payload->'data'->'date','classification',r.payload->'classification',
 'title',CASE r.kind WHEN 'application' THEN r.payload->'data'->>'concept' WHEN 'error' THEN r.payload->'data'->>'error_type' ELSE r.payload->'data'->>'name' END,
 'preview',left(coalesce(CASE r.kind WHEN 'application' THEN r.payload->'data'->>'scenario' ELSE r.payload->'data'->>'description' END,''),160),
 'grade',CASE r.kind WHEN 'application' THEN r.payload->'data'->'effectiveness' WHEN 'error' THEN r.payload->'data'->'severity' ELSE 'null'::jsonb END,
 'is_repeat',r.payload->'data'->'is_repeat','related_error_id',r.payload->'data'->'related_error_id','created_at',r.payload->'created_at','updated_at',r.payload->'updated_at')`;
