import type { LightTickOwner } from "../lighttick.types.ts";
import type { ArticleContent, ReadingMaterial } from "./reading.types.ts";
import type { ModelSelection } from "../personal-model/personal-model.types.ts";
export interface ReadingSource {
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
    source_id?: string;
    source_revision?: number;
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
  };
  output: {
    entries?: ArticleContent[];
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
      extraction_version?:string;
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
  source(o: LightTickOwner, id: string): Promise<ReadingSource | undefined>;
  sources(
    o: LightTickOwner,
    after: string,
    limit: number,
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
