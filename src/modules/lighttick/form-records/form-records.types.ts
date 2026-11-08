import type { LightTickOwner } from "../lighttick.types.ts";
export interface FormModule {
  id: string;
  name: string;
  color: string;
  order: number;
}
export interface FormRecords {
  modules: FormModule[];
  checkins: Record<string, Record<string, number>>;
  habits: Record<string, { minutes: number; note: string }>;
  customFields: {
    key: string;
    label: string;
    type: "text" | "number" | "date";
  }[];
  customRecords: Record<string, unknown>[];
  decisions: Record<string, unknown>[];
  predictions: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
  insights: Record<string, unknown>[];
  todos: Record<string, unknown>[];
}
export interface FormSnapshot {
  revision: number;
  data: FormRecords;
  updated_at: string | null;
}
export interface FormRecordsRepository {
  get(owner: LightTickOwner): Promise<FormSnapshot | undefined>;
  save(
    owner: LightTickOwner,
    snapshot: FormSnapshot,
    base: number,
  ): Promise<void>;
}
