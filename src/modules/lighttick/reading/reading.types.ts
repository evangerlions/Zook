import type { LightTickOwner } from "../lighttick.types.ts";
export interface ArticleContent {
  title: string;
  body: string;
  source_url: string | null;
  language: string;
  published_at: string | null;
  author?: string | null;
  tags?: string[];
}
export interface ArticlePrivate {
  notes: string;
  bookmark: boolean;
  later: boolean;
  read: boolean;
  read_at: string | null;
  feedback: string;
  positions: Record<string, number>;
}
export interface ReadingArticle {
  id: string;
  revision: number;
  content_version: string;
  content: ArticleContent;
  personal: ArticlePrivate;
  archived: boolean;
  created_at: string;
  updated_at: string;
  materials?: ReadingMaterial[];
}
export interface ReadingMaterial {
  kind: "guide" | "translation" | "summary" | "english";
  paragraph_id: string | null;
  draft: {
    version: number;
    text: string;
    origin: "manual" | "ai";
    created_at: string;
  };
  adopted: (ReadingMaterial["draft"] & { adopted_at: string }) | null;
}
export interface ArticleQuery {
  search: string;
  filter: "all" | "bookmark" | "later" | "read" | "feedback" | "archived";
  after: string;
  limit: number;
}
import type { VocabularyStore } from "./vocabulary.types.ts";
export interface ReadingRepository extends VocabularyStore {
  get(o: LightTickOwner, id: string): Promise<ReadingArticle | undefined>;
  list(o: LightTickOwner, q: ArticleQuery): Promise<ReadingArticle[]>;
  history(
    o: LightTickOwner,
    id: string,
    before: number,
    limit: number,
  ): Promise<ReadingArticle[]>;
  save(o: LightTickOwner, row: ReadingArticle, base: number): Promise<void>;
}
