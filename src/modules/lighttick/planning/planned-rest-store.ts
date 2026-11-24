import type { LightTickOwner } from "../lighttick.types.ts";

export interface PlannedRestDate {
  date: string;
  planned_rest: boolean;
  version: number;
}

export interface PlannedRestStore {
  get(owner: LightTickOwner, date: string): Promise<PlannedRestDate | undefined>;
  list(owner: LightTickOwner, startsOn: string, endsOn: string): Promise<string[]>;
  save(owner: LightTickOwner, rest: PlannedRestDate): Promise<PlannedRestDate>;
}
