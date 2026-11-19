import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner } from "./lighttick.types.ts";
import { ApplicationError } from "../../shared/errors.ts";

/**
 * 学习笔记 — 课程笔记与练习答案暂存。
 */

export type NoteKind = "yingyu" | "biaoda" | "renzhi" | "plan";

export const NOTE_KINDS: NoteKind[] = ["yingyu", "biaoda", "renzhi", "plan"];

export const NOTE_LABELS: Record<NoteKind, string> = {
  yingyu: "英文阅读",
  biaoda: "结构化表达",
  renzhi: "认知课程",
  plan: "课程规划",
};

export interface StudyNote {
  kind: NoteKind;
  course_id: string;
  notes: string;
  answers: Record<string, string>;
  revision: number;
  updated_at: string;
}

export interface StudyNoteRow extends LightTickOwner {
  id: string;
  payload: StudyNote;
}

export interface StudyNoteListResult {
  items: StudyNoteListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface StudyNoteListItem {
  kind: NoteKind;
  course_id: string;
  module_label: string;
  title: string;
  preview: string;
  answer_count: number;
  updated_at: string;
  revision: number;
}

export class LightTickStudyNotesService {
  constructor(private readonly repository: LightTickRepository) {}

  async save(owner: LightTickOwner, input: {
    kind: NoteKind;
    course_id: string;
    notes: string;
    answers: Record<string, string>;
    base_revision: number;
    key: string;
  }): Promise<StudyNote> {
    if (!NOTE_KINDS.includes(input.kind)) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "kind is invalid.");
    }
    if (!input.course_id || input.course_id.length > 500) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "course_id is invalid.");
    }
    if (input.course_id.includes("..") || input.course_id.includes("/./")) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "course_id is invalid.");
    }
    if (typeof input.notes !== "string" || input.notes.length > 10000) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "notes must be ≤10000 chars.");
    }
    if (!input.answers || typeof input.answers !== "object" || Array.isArray(input.answers)) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "answers must be an object.");
    }
    const answerKeys = Object.keys(input.answers);
    if (answerKeys.length > 100) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "answers must have ≤100 entries.");
    }
    for (const [k, v] of Object.entries(input.answers)) {
      if (k.length > 500 || typeof v !== "string" || v.length > 10000) {
        throw new ApplicationError(400, "REQ_FIELD_INVALID", "answer entries are invalid.");
      }
    }
    const totalAnswerLength = Object.values(input.answers).reduce((sum, v) => sum + v.length, 0);
    if (totalAnswerLength > 60000) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "answers total length must be ≤60000 chars.");
    }
    if (!input.key || input.key.length < 8 || input.key.length > 160) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "key must be 8-160 chars.");
    }
    if (!Number.isInteger(input.base_revision) || input.base_revision < 0 || input.base_revision > 2147483646) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "base_revision is invalid.");
    }

    return await this.repository.saveStudyNote(owner, {
      kind: input.kind,
      course_id: input.course_id,
      notes: input.notes,
      answers: input.answers,
      revision: input.base_revision + 1,
      updated_at: new Date().toISOString(),
    });
  }

  async get(owner: LightTickOwner, kind: NoteKind, courseId: string): Promise<StudyNote | undefined> {
    return await this.repository.getStudyNote(owner, kind, courseId);
  }

  async list(owner: LightTickOwner, query: {
    q?: string;
    kind?: NoteKind;
    page?: number;
    page_size?: number;
  }): Promise<StudyNoteListResult> {
    return await this.repository.listStudyNotes(owner, query);
  }
}
