import type { LightTickOwner } from "../lighttick.types.ts";
export interface ReadingSource {
  id: string;
  revision: number;
  name: string;
  url: string;
  language: "zh" | "en";
  topics: string[];
  enabled: boolean;
  custom: boolean;
  updated_at: string;
}
export interface FeedCandidate {
  id: string;
  url: string;
  title: string;
  summary: string;
  source: string;
  language: "zh" | "en";
  topic: string;
  saved_article_id?: string;
}
export interface ReadingCollection {
  id: string;
  revision: number;
  request_hash: string;
  status: "ready" | "failed";
  candidates: FeedCandidate[];
  sources: { id: string; name: string; count: number; error?: string }[];
  updated_at: string;
}
export interface ReadingTask {
  id: string;
  revision: number;
  article_id: string;
  title: string;
  business_date: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  updated_at: string;
}
export interface ReadingEntries {
  source: ReadingSource;
  collection: ReadingCollection;
  task: ReadingTask;
}
export interface ReadingWorkflowRepository {
  getReadingEntry<K extends keyof ReadingEntries>(
    owner: LightTickOwner,
    kind: K,
    id: string,
  ): Promise<ReadingEntries[K] | undefined>;
  listReadingEntries<K extends keyof ReadingEntries>(
    owner: LightTickOwner,
    kind: K,
    query?: {businessDate?:string;limit?:number;start?:string;end?:string},
  ): Promise<ReadingEntries[K][]>;
  saveReadingEntry<K extends keyof ReadingEntries>(
    owner: LightTickOwner,
    kind: K,
    entry: ReadingEntries[K],
  ): Promise<void>;
  deleteReadingEntry(
    owner: LightTickOwner,
    kind: keyof ReadingEntries,
    id: string,
  ): Promise<void>;
}
