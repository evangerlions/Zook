import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { NOTE_LABELS, type NoteKind, type StudyNote, type StudyNoteListResult } from "../../../modules/lighttick/lighttick-study-notes.service.ts";
import type { QueryClient } from "./postgres-lighttick-owner-transaction.ts";
import { timestampString } from "./postgres-lighttick-row-mappers.ts";
import { versionConflict } from "./postgres-lighttick-conflicts.ts";

export class PostgresLightTickStudyNotesStore {
  constructor(private readonly query: QueryClient["query"]) {}

  async save(owner: LightTickOwner, note: StudyNote): Promise<StudyNote> {
    const params = [owner.appId, owner.userId, note.kind, note.course_id, note.notes, JSON.stringify(note.answers), note.revision, note.updated_at];
    const result = note.revision === 1
      ? await this.query(`INSERT INTO zook_lighttick_study_notes(app_id,user_id,kind,course_id,notes,answers,revision,updated_at)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT DO NOTHING RETURNING revision`, params)
      : await this.query(`UPDATE zook_lighttick_study_notes SET notes=$5,answers=$6::jsonb,revision=$7,updated_at=$8
          WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND course_id=$4 AND revision=$7-1 RETURNING revision`, params);
    if (!result.rows.length) versionConflict(note.course_id);
    return note;
  }

  async get(owner: LightTickOwner, kind: NoteKind, courseId: string): Promise<StudyNote | undefined> {
    const { rows } = await this.query(`SELECT kind,course_id,notes,answers,revision,updated_at FROM zook_lighttick_study_notes
      WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND course_id=$4`, [owner.appId, owner.userId, kind, courseId]);
    const row = rows[0];
    if (!row) return undefined;
    return {
      kind, course_id: courseId, notes: String(row.notes), answers: row.answers as StudyNote["answers"],
      revision: Number(row.revision), updated_at: timestampString(row.updated_at),
    };
  }

  async list(owner: LightTickOwner, query: { q?: string; kind?: NoteKind; page?: number; page_size?: number }): Promise<StudyNoteListResult> {
    const page = query.page ?? 1;
    const size = query.page_size ?? 20;
    const params = [owner.appId, owner.userId, query.kind ?? null, query.q ?? ""];
    const where = `app_id=$1 AND user_id=$2 AND ($3::text IS NULL OR kind=$3)
      AND ($4::text='' OR strpos(lower(notes),lower($4))>0 OR strpos(lower(answers::text),lower($4))>0)`;
    const count = await this.query(`SELECT count(*)::int AS total FROM zook_lighttick_study_notes WHERE ${where}`, params);
    const { rows } = await this.query(`SELECT kind,course_id,notes,answers,revision,updated_at FROM zook_lighttick_study_notes
      WHERE ${where} ORDER BY updated_at DESC, kind, course_id LIMIT $5 OFFSET $6`, [...params, size, (page - 1) * size]);
    return {
      items: rows.map(row => {
        const kind = row.kind as NoteKind;
        const notes = String(row.notes);
        return {
          kind, course_id: String(row.course_id), module_label: NOTE_LABELS[kind],
          title: notes.split("\n", 1)[0].slice(0, 100) || "学习笔记", preview: notes.slice(0, 200),
          answer_count: Object.keys(row.answers as StudyNote["answers"]).length,
          revision: Number(row.revision), updated_at: timestampString(row.updated_at),
        };
      }),
      total: Number(count.rows[0].total), page, page_size: size,
    };
  }
}
