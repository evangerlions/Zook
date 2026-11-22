import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  ExperienceQuery,
  ExperienceAggregate,
} from "../../../modules/lighttick/experience/experience.types.ts";
import { experienceWhere, EXPERIENCE_OBJECTS } from "./experience-query.ts";
export async function postgresExperienceAggregate(
  query: (
    sql: string,
    args?: unknown[],
  ) => Promise<{ rows: Record<string, any>[] }>,
  o: LightTickOwner,
  q: ExperienceQuery,
  start: string,
  end: string,
): Promise<ExperienceAggregate[]> {
  const w = experienceWhere(o, q, false),
    from = w.bind(start),
    to = w.bind(end);
  const result = await query(
    `WITH filtered AS (
 SELECT r.payload->'data' AS d FROM ${EXPERIENCE_OBJECTS} WHERE ${w.where()}
 ), known AS(SELECT d FROM filtered WHERE d->>'date'>=${from} AND d->>'date'<=${to}), metrics AS (
 SELECT jsonb_build_object('kind','metrics','key',null,'count',count(*),
 'unknown_date',(SELECT count(*) FROM filtered WHERE d->>'date' IS NULL),
 'severity_sum',coalesce(sum((d->>'severity')::int),0),'severity_known',count(d->>'severity'),
 'repeat_true',count(*) FILTER(WHERE d->>'is_repeat'='true'),'repeat_known',count(d->>'is_repeat'),
 'effectiveness_sum',coalesce(sum((d->>'effectiveness')::int) FILTER(WHERE (d->>'effectiveness')::int>0),0),
 'effectiveness_known',count(*) FILTER(WHERE (d->>'effectiveness')::int>0),'effectiveness_unrated',count(*) FILTER(WHERE d->>'effectiveness'='0')) AS value FROM known
 ), groups AS (
 SELECT 'module'::text AS kind,d->>'module_id' AS key,count(*) AS n FROM known GROUP BY d->>'module_id'
 UNION ALL SELECT 'day',d->>'date',count(*) FROM known GROUP BY d->>'date'
 UNION ALL SELECT CASE WHEN $4='application' THEN 'concept' ELSE 'type' END,CASE WHEN $4='application' THEN d->>'concept' ELSE d->>'error_type' END,count(*) FROM known GROUP BY CASE WHEN $4='application' THEN d->>'concept' ELSE d->>'error_type' END
 ) SELECT value FROM metrics UNION ALL SELECT jsonb_build_object('kind',kind,'key',key,'count',n) FROM groups LIMIT 10002`,
    w.args,
  );
  return result.rows.map((r) => r.value);
}
