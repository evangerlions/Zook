import type { LightTickOwner } from "../lighttick.types.ts";
export interface ReadingPreferencesValue {
  enabled: boolean;
  hour: number;
  minute: number;
  count: number;
  mode: "recent" | "classic" | "mixed";
  topics: string[];
  languages: ("zh" | "en")[];
  query: string;
  auto_guide: boolean;
  source_ids?: string[] | null;
}
export interface ReadingPreferences {
  revision: number;
  value: ReadingPreferencesValue;
  updated_at: string | null;
}
export interface ReadingPreferencesRepository {
  get(o: LightTickOwner): Promise<ReadingPreferences | undefined>;
  history(
    o: LightTickOwner,
    before: number,
    limit: number,
  ): Promise<ReadingPreferences[]>;
  save(o: LightTickOwner, row: ReadingPreferences, base: number): Promise<void>;
}
