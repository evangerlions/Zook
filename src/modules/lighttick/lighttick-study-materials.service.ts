import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { ApplicationError } from "../../shared/errors.ts";

/**
 * 学习资料 — 课程资料与学习记录。
 */

export type MaterialModule = "yingyu" | "biaoda";

export const MATERIAL_MODULES: Record<MaterialModule, { name: string; folder: string; duration: string }> = {
  yingyu: { name: "英文阅读", folder: "每日文章", duration: "35 分钟" },
  biaoda: { name: "结构化表达", folder: "每日练习", duration: "15 分钟" },
};

export interface LearningRecord {
  module_id: MaterialModule;
  filename: string;
  lesson_no: number;
  topic: string;
  summary_text: string;
  time_spent_seconds: number;
  completed_at: string;
  updated_at: string;
  revision: number;
}

export interface LearningRecordRow extends LightTickOwner {
  id: string;
  payload: LearningRecord;
}

export interface LessonInfo {
  filename: string;
  lesson_no: number;
  topic: string;
  date: string;
  learning_label: string;
  learning_state: "completed" | "unknown";
  version: string;
  record_revision: number;
  completed_at?: string;
}

export class LightTickStudyMaterialsService {
  constructor(private readonly repository: LightTickRepository) {}

  async listModules(owner: LightTickOwner): Promise<{ modules: { id: MaterialModule; name: string; duration: string; lessons: LessonInfo[] }[] }> {
    const modules = [];
    for (const [id, info] of Object.entries(MATERIAL_MODULES)) {
      const lessons = await this.repository.listStudyLessons(owner, id as MaterialModule);
      modules.push({ id: id as MaterialModule, name: info.name, duration: info.duration, lessons });
    }
    return { modules };
  }

  async getLesson(owner: LightTickOwner, module: MaterialModule, filename: string): Promise<{ content: string; lesson: LessonInfo; record: LearningRecord | undefined }> {
    const lesson = await this.repository.getStudyLesson(owner, module, filename);
    if (!lesson) {
      throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Lesson not found.");
    }
    const content = await this.repository.getStudyLessonContent(owner, module, filename);
    const record = await this.repository.getStudyLearningRecord(owner, module, filename);
    return { content: content ?? "", lesson, record };
  }

  async saveLearningRecord(owner: LightTickOwner, input: {
    module_id: MaterialModule;
    filename: string;
    summary_text: string;
    time_spent_seconds: number;
    base_revision: number;
    key: string;
  }): Promise<LearningRecord> {
    if (!Object.keys(MATERIAL_MODULES).includes(input.module_id)) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "module_id is invalid.");
    }
    if (!input.filename || input.filename.length > 500) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "filename is invalid.");
    }
    if (typeof input.summary_text !== "string" || input.summary_text.length > 10000) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "summary_text must be ≤10000 chars.");
    }
    if (!Number.isInteger(input.time_spent_seconds) || input.time_spent_seconds < 0 || input.time_spent_seconds > 86400) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "time_spent_seconds must be 0-86400.");
    }
    if (!Number.isInteger(input.base_revision) || input.base_revision < 0) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "base_revision is invalid.");
    }
    if (!input.key || input.key.length < 8 || input.key.length > 160) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "key must be 8-160 chars.");
    }

    return await this.repository.saveStudyLearningRecord(owner, input);
  }

  async getLearningHistory(owner: LightTickOwner, start: string, end: string): Promise<{ total: number; items: LearningRecord[] }> {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0 || diffDays > 366) {
      throw new ApplicationError(422, "REQ_FIELD_INVALID", "Date range must be 0-366 days.");
    }
    const items = await this.repository.listStudyLearningHistory(owner, start, end);
    return { total: items.length, items };
  }
}
