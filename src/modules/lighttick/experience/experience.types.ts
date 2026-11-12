import type { LightTickOwner } from "../lighttick.types.ts";
export type ExperienceKind = "application" | "error" | "error_type";
export interface Classification {
  id: string;
  title: string;
  revision: number;
  basis: "grow-category-v1" | "learning-module";
}
export interface ApplicationData {
  date: string | null;
  module_id: string | null;
  concept: string;
  scenario: string | null;
  effectiveness: number | null;
}
export interface ErrorData {
  date: string | null;
  module_id: string | null;
  error_type: string;
  type_id: string | null;
  description: string;
  severity: number | null;
  context: string | null;
  improvement_action: string | null;
  is_repeat: boolean | null;
  related_error_id: string | null;
}
export interface ErrorTypeData {
  name: string;
  description: string;
}
export interface ExperienceObject {
  id: string;
  kind: ExperienceKind;
  revision: number;
  archived: boolean;
  classification: Classification | null;
  data: ApplicationData | ErrorData | ErrorTypeData;
  type_revision: number | null;
  created_at: string | null;
  updated_at: string | null;
}
export interface ExperienceTombstone {
  id: string;
  kind: ExperienceKind;
  revision: number;
  deleted: true;
  deleted_at: string;
}
export interface ExperienceSummary {
  id: string;
  kind: ExperienceKind;
  revision: number;
  archived: boolean;
  date: string | null;
  classification: Classification | null;
  title: string;
  preview: string;
  grade: number | null;
  is_repeat: boolean | null;
  related_error_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}
export interface ExperienceQuery {
  kind: ExperienceKind;
  archived: "active" | "archived" | "all";
  date_from: string | null;
  date_to: string | null;
  module_id: string | null;
  error_type: string | null;
  is_repeat: boolean | null;
  search: string;
  after: { date: string | null; id: string; count?: number } | null;
  limit: number;
}
export interface ExperienceAggregate {
  kind: "metrics" | "module" | "type" | "concept" | "day";
  key: string | null;
  count: number;
  severity_sum?: number;
  severity_known?: number;
  repeat_true?: number;
  repeat_known?: number;
  effectiveness_sum?: number;
  effectiveness_known?: number;
  effectiveness_unrated?: number;
  unknown_date?: number;
}
export interface ExperienceRepeated {
  error_type: string;
  count: number;
  first_occurrence: string | null;
  last_occurrence: string | null;
  unknown_dates: number;
}
export interface ExperienceScope {
  versions: number;
  references: number;
  receipts: { key: string; hash: string }[];
}
export type ExperienceSection =
  | "objects"
  | "versions"
  | "tombstones"
  | "receipts";
export interface ExperienceExportRecord {
  key: string;
  value: Record<string, unknown>;
}
export interface ExperienceRepository {
  entries(
    o: LightTickOwner,
    section: ExperienceSection,
    after: string,
    limit: number,
  ): Promise<ExperienceExportRecord[]>;
  get(
    o: LightTickOwner,
    kind: ExperienceKind,
    id: string,
  ): Promise<ExperienceObject | undefined>;
  tombstone(
    o: LightTickOwner,
    kind: ExperienceKind,
    id: string,
  ): Promise<ExperienceTombstone | undefined>;
  save(o: LightTickOwner, row: ExperienceObject, base: number): Promise<void>;
  page(o: LightTickOwner, q: ExperienceQuery): Promise<ExperienceSummary[]>;
  history(
    o: LightTickOwner,
    kind: ExperienceKind,
    id: string,
    before: number,
    limit: number,
  ): Promise<ExperienceObject[]>;
  typeNameUsed(
    o: LightTickOwner,
    name: string,
    except: string,
  ): Promise<boolean>;
  scope(
    o: LightTickOwner,
    kind: ExperienceKind,
    id: string,
  ): Promise<ExperienceScope>;
  erase(o: LightTickOwner, t: ExperienceTombstone): Promise<void>;
  aggregate(
    o: LightTickOwner,
    q: ExperienceQuery,
    start: string,
    end: string,
  ): Promise<ExperienceAggregate[]>;
  repeated(
    o: LightTickOwner,
    q: ExperienceQuery,
  ): Promise<ExperienceRepeated[]>;
  concepts(o: LightTickOwner, after: string, limit: number): Promise<string[]>;
}
