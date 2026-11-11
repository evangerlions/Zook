import type { LightTickOwner } from "../lighttick.types.ts";
export interface ArticleContent {
  title: string;
  body: string;
  source_url: string | null;
  language: string;
  published_at: string | null;
  author?: string | null;
  tags?: string[];
  translated_title?: string | null;
  publisher?: string | null;
  description?: string | null;
  topics?: string[];
  category?: "recent" | "classic" | "manual" | null;
  access?: string | null;
  recommendation_reason?: string | null;
  published_date?: string | null;
}
export interface ReadingFeedback {
  version: number;
  value: "" | "insightful" | "neutral" | "not_for_me";
  difficulty: "" | "easy" | "right" | "hard";
  takeaway: string;
  question: string;
  action: string;
  tags: string[];
  updated_at: string | null;
}
export interface ArticlePrivate {
  notes: string;
  bookmark: boolean;
  later: boolean;
  read: boolean;
  read_at: string | null;
  feedback: string;
  structured_feedback?: ReadingFeedback;
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
  provenance?: ReadingProvenance;
}
export interface ReadingProvenance {
  kind:
    | "manual_import"
    | "web_text"
    | "pdf_text"
    | "feed_entry"
    | "full_fetch"
    | "legacy_import";
  work_id: string | null;
  source_id: string | null;
  parent_article_id: string | null;
  root_article_id: string;
  fetched_at: string | null;
  raw_sha256: string | null;
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
export interface ReadingCatalogEntry {
  id: string;
  revision: number;
  content_version: string;
  title: string;
  preview: string;
  language: string;
  source_url: string | null;
  published_at: string | null;
  published_date: string | null;
  archived: boolean;
  bookmark: boolean;
  later: boolean;
  read: boolean;
  has_feedback: boolean;
  created_at: string;
  updated_at: string;
}
export interface ArticleQuery {
  search: string;
  filter: "all" | "bookmark" | "later" | "read" | "feedback" | "archived";
  after: string;
  limit: number;
}
import type { VocabularyStore } from "./vocabulary.types.ts";
export interface ReadingRepository extends VocabularyStore {
  recommendationHistory(
    o: LightTickOwner,
  ): Promise<
    import("./reading-recommendation.ts").ReadingRecommendationHistory[]
  >;
  get(o: LightTickOwner, id: string): Promise<ReadingArticle | undefined>;
  list(o: LightTickOwner, q: ArticleQuery): Promise<ReadingArticle[]>;
  catalog(o: LightTickOwner, q: ArticleQuery): Promise<ReadingCatalogEntry[]>;
  history(
    o: LightTickOwner,
    id: string,
    before: number,
    limit: number,
  ): Promise<ReadingArticle[]>;
  save(o: LightTickOwner, row: ReadingArticle, base: number): Promise<void>;
  editions(
    o: LightTickOwner,
    rootId: string,
    after: string,
    limit: number,
  ): Promise<ReadingArticle[]>;
}
