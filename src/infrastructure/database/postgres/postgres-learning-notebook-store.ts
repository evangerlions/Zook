import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type { NotebookEntry, NotebookPage, NotebookQuery } from "../../../modules/lighttick/learning/learning-notebook.types.ts";
import { notePreview } from "../../../modules/lighttick/learning/learning-notebook.types.ts";
type Query=(sql:string,values:unknown[])=>Promise<{rows:Record<string,unknown>[]} >;
// Private rows are scoped before joins. Never select lesson bodies or return full answers.
const BASE=`WITH notes AS (
 SELECT p.lesson_id,p.content_version,p.notes,p.notes_revision,a.answers_text,a.answer_count,
   l.title,COALESCE(l.module_id,c.module_id) AS module_id,
   CASE WHEN COALESCE(l.module_id,c.module_id) IS NOT NULL THEN 'module/'||COALESCE(l.module_id,c.module_id)
        WHEN r.id IS NOT NULL THEN 'courses' ELSE 'unassigned' END AS module,
   COALESCE(m.title,t.title,CASE WHEN COALESCE(l.module_id,c.module_id) IS NOT NULL THEN COALESCE(l.module_id,c.module_id)
        WHEN r.id IS NOT NULL THEN '课程规划' ELSE '未分类课程' END) AS module_label,
   COALESCE(h.saved_at,p.updated_at) AS updated_at,
   p.content_version=l.published_version AS is_current,
   NOT l.archived AND NOT c.archived AND l.published_version IS NOT NULL AS available
 FROM zook_lighttick_native_learning_private p
 JOIN zook_lighttick_native_lessons l ON l.app_id=p.app_id AND l.user_id=p.user_id AND l.id=p.lesson_id
 JOIN zook_lighttick_learning_collections c ON c.app_id=l.app_id AND c.user_id=l.user_id AND c.id=l.collection_id
 LEFT JOIN zook_lighttick_learning_modules m ON m.app_id=l.app_id AND m.user_id=l.user_id AND m.id=COALESCE(l.module_id,c.module_id)
 LEFT JOIN zook_lighttick_learning_module_templates t ON t.id=COALESCE(l.module_id,c.module_id)
 LEFT JOIN zook_lighttick_learning_routes r ON r.app_id=l.app_id AND r.user_id=l.user_id AND r.id=l.collection_id
 CROSS JOIN LATERAL (SELECT COUNT(*)::int AS answer_count,COALESCE(string_agg(v->>'answer',' '),'') AS answers_text
    FROM jsonb_array_elements(p.answers) v WHERE COALESCE(v->>'answer','') ~ '[^[:space:]]') a
 LEFT JOIN LATERAL (SELECT MAX(created_at) AS saved_at FROM zook_lighttick_native_learning_history
    WHERE app_id=p.app_id AND user_id=p.user_id AND lesson_id=p.lesson_id AND content_version=p.content_version
      AND component IN ('initial','notes','import') AND state->>'notesRevision'=p.notes_revision::text) h ON true
 WHERE p.app_id=$1 AND p.user_id=$2 AND (p.notes ~ '[^[:space:]]' OR a.answer_count>0)
)`;
const FILTER=` WHERE ($3='' OR strpos(lower(concat_ws(' ',notes,answers_text,lesson_id,title)),lower($3))>0) AND ($4='' OR module=$4)`;
export class PostgresLearningNotebookStore {
  constructor(private readonly query:Query) {}
  async list(owner:LightTickOwner,input:NotebookQuery):Promise<NotebookPage> {
    const args=[owner.appId,owner.userId,input.q,input.module];
    const count=await this.query(BASE+" SELECT COUNT(*)::int AS total FROM notes"+FILTER,args);
    const total=Number(count.rows[0]?.total ?? 0),page=Math.min(input.page,Math.max(1,Math.ceil(total/input.page_size)));
    const rows=await this.query(BASE+` SELECT lesson_id,content_version,title,module,module_label,notes_revision,answer_count,
      left(regexp_replace(concat_ws(' ',NULLIF(btrim(notes),''),NULLIF(btrim(answers_text),'')),'[[:space:]]+',' ','g'),240) AS preview,
      updated_at,is_current,available FROM notes`+FILTER+` ORDER BY updated_at DESC,lesson_id COLLATE "C",content_version COLLATE "C" LIMIT $5 OFFSET $6`,[...args,input.page_size,(page-1)*input.page_size]);
    const modules=await this.query(BASE+` SELECT module,min(module_label) AS title FROM notes GROUP BY module ORDER BY module COLLATE "C"`,[owner.appId,owner.userId]);
    return {total,page,page_size:input.page_size,modules:modules.rows.map(r=>({key:String(r.module),title:String(r.title)})),items:rows.rows.map(r=>({
      lesson_id:String(r.lesson_id),content_version:String(r.content_version),title:String(r.title),module:String(r.module),module_label:String(r.module_label),
      notes_revision:Number(r.notes_revision),answer_count:Number(r.answer_count),preview:notePreview(String(r.preview),""),
      updated_at:r.updated_at instanceof Date?r.updated_at.toISOString():String(r.updated_at),is_current:r.is_current===true,available:r.available===true,
    } satisfies NotebookEntry))};
  }
}
