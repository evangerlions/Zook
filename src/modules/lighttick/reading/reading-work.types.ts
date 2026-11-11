import type { ReadingRecommendationInput } from "./reading-recommendation.types.ts";
import type {
  ReadingAssetsRepository,
  ReadingEntryReference,
} from "./reading-assets.types.ts";
import type { ReadingCandidate } from "./reading-candidate.types.ts";
import type { ReadingPreferencesRepository } from "./reading-preferences.types.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { ArticleContent, ReadingMaterial } from "./reading.types.ts";
import type { ModelSelection } from "../personal-model/personal-model.types.ts";
export interface ReadingSource {
  language?: "zh" | "en" | "unknown";
  topics?: string[];
  domains?: string[];
  custom?: boolean;
  catalog_id?: string | null;
  catalog_origin_id?: string | null;
  deleted_at?: string | null;
  id: string;
  revision: number;
  title: string;
  url: string;
  format: "article" | "rss" | "atom";
  archived: boolean;
  created_at: string;
  updated_at: string;
}
export type ReadingWorkKind =
  | "recommend"
  | "collect_url"
  | "collect_source"
  | "fetch_full"
  | ReadingMaterial["kind"];
export interface ReadingWork extends LightTickOwner {
  id: string;
  revision: number;
  kind: ReadingWorkKind;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  input: {
    recommendation?: ReadingRecommendationInput;
    source_id?: string;
    source_revision?: number;
    source_domains?: string[];
    url?: string;
    format?: ReadingSource["format"];
    title?: string;
    article_id?: string;
    content_version?: string;
    paragraph_id?: string | null;
    text?: string;
    model_selection?: ModelSelection;
    source_metadata?: Omit<ArticleContent, "body">;
    parent_root_id?: string;
    candidate_work_id?: string;
    candidate_id?: string;
    candidate_output_digest?: string;
  };
  output: {
    recommendation?: {
      date: string;
      requested: number;
      selected: number;
      attempted: number;
      ranking_version: string;
      scope_digest: string;
    };
    documents?: { asset_id: string; url: string; sha256: string }[];
    entry_refs?: ReadingEntryReference[];
    entries?: ArticleContent[];
    candidates?: ReadingCandidate[];
    warnings?: string[];
    text?: string;
    provider?: string;
    model?: string;
    prompt_version?: string;
    document?: {
      body: string;
      content_type: string;
      url: string;
      sha256: string;
      capture_kind: string;
      encoding?: "base64";
      extraction_version?: string;
      resolved_url?: string;
    };
  } | null;
  adopted: Record<string, { article_id: string; revision: number }>;
  attempt: number;
  fence: string | null;
  lease_until: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}
export interface ReadingWorkRepository {
  readonly assets: ReadingAssetsRepository;
  readonly preferences: ReadingPreferencesRepository;
  source(o: LightTickOwner, id: string): Promise<ReadingSource | undefined>;
  sources(
    o: LightTickOwner,
    after: string,
    limit: number,
    includeDeleted?: boolean,
  ): Promise<ReadingSource[]>;
  sourceHistory(
    o: LightTickOwner,
    id: string,
    before: number,
    limit: number,
  ): Promise<ReadingSource[]>;
  saveSource(
    o: LightTickOwner,
    row: ReadingSource,
    base: number,
  ): Promise<void>;
  get(o: LightTickOwner, id: string): Promise<ReadingWork | undefined>;
  list(o: LightTickOwner, after: string, limit: number): Promise<ReadingWork[]>;
  recent(o: LightTickOwner, since: string): Promise<ReadingWork[]>;
  recoverable(now: string, limit: number): Promise<ReadingWork[]>;
  save(row: ReadingWork, base: number): Promise<void>;
}
