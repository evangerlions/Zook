import type { LightTickOwner } from "../lighttick.types.ts";
export interface NotebookQuery { q: string; module: string; page: number; page_size: number }
export interface NotebookEntry {
  lesson_id: string;
  content_version: string;
  title: string;
  module: string;
  module_label: string;
  notes_revision: number;
  answer_count: number;
  preview: string;
  updated_at: string;
  is_current: boolean;
  available: boolean;
}
export interface NotebookPage {
  items: NotebookEntry[];
  total: number;
  page: number;
  page_size: number;
  modules: { key: string; title: string }[];
}
export const notePreview = (notes: string, answers: string) =>
  Array.from([notes.trim(), answers.trim()].filter(Boolean).join(" ").replace(/\s+/gu," ")).slice(0,240).join("");

export interface LearningNotebookRepository { queryLearningNotebook(owner:LightTickOwner,query:NotebookQuery):Promise<NotebookPage> }
