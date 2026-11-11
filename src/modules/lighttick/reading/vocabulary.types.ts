import type { LightTickOwner } from "../lighttick.types.ts";

export type VocabularyFeedback = "again" | "hard" | "good";

export interface VocabularyReview {
  feedback: VocabularyFeedback;
  step_before: number;
  step_after: number;
  reviewed_at: string;
}

export interface VocabularyEntry {
  id: string;
  revision: number;
  word: string;
  normalized: string;
  article_id: string;
  source_version: string;
  context_sentence: string;
  contextual_meaning: string;
  part_of_speech: string;
  pronunciation: string;
  step: number;
  next_review: string;
  paused: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface VocabularyStats {
  total: number;
  active: number;
  paused: number;
  archived: number;
  due: number;
}
export interface VocabularyQuery {
  article_id: string;
  filter: string;
  today: string;
  after_id: string;
  after_date: string;
  limit: number;
}
export interface VocabularyStore {
  getVocabulary(
    owner: LightTickOwner,
    id: string,
  ): Promise<VocabularyEntry | undefined>;
  duplicateVocabulary(
    owner: LightTickOwner,
    article: string,
    normalized: string,
  ): Promise<boolean>;
  vocabularyPage(
    owner: LightTickOwner,
    q: VocabularyQuery,
  ): Promise<{ items: VocabularyEntry[]; stats: VocabularyStats }>;
  vocabularyIdUsed(owner: LightTickOwner, id: string): Promise<boolean>;
  listVocabulary(owner: LightTickOwner): Promise<VocabularyEntry[]>;
  listVocabularyReviews(
    owner: LightTickOwner,
    id: string,
  ): Promise<VocabularyReview[]>;
  saveVocabulary(
    owner: LightTickOwner,
    entry: VocabularyEntry,
    review?: VocabularyReview,
  ): Promise<void>;
  deleteVocabulary(owner: LightTickOwner, id: string): Promise<void>;
}
