import type { LightTickOwner } from "../../lighttick.types.ts";
import type { ResearchEvidence } from "../research/research.types.ts";
export type Material = ResearchEvidence & {
  instrument_id?: string | null;
  account_id?: string | null;
  period_end?: string | null;
  id: string;
  revision: number;
  request_key: string;
  content_digest: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
};
export type MaterialSummary = Pick<
  Material,
  | "id"
  | "revision"
  | "title"
  | "content_digest"
  | "archived"
  | "available_at"
  | "updated_at"
>;
export type MaterialSource = {
  id: string;
  version: number;
  content_digest: string;
};
export type MaterialReference = {
  research_id: string;
  research_revision: number;
  title: string;
  instrument_id: string;
  archived: boolean;
  material_version: number;
};
export const materialSummary = (m: Material): MaterialSummary => ({
  id: m.id,
  revision: m.revision,
  title: m.title,
  content_digest: m.content_digest,
  archived: m.archived,
  available_at: m.available_at,
  updated_at: m.updated_at,
});
export interface MaterialRepository {
  get(o: LightTickOwner, id: string): Promise<Material | undefined>;
  version(
    o: LightTickOwner,
    id: string,
    revision: number,
  ): Promise<Material | undefined>;
  list(o: LightTickOwner): Promise<MaterialSummary[]>;
  versions(
    o: LightTickOwner,
    id: string,
    before: number,
    limit: number,
  ): Promise<Material[]>;
  references(o: LightTickOwner, id: string): Promise<MaterialReference[]>;
  save(o: LightTickOwner, m: Material, base: number): Promise<void>;
}
