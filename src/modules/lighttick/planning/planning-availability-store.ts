import type { LightTickOwner } from "../lighttick.types.ts";

export interface PlanningAvailability {
  available_weekdays: number[] | null;
  version: number;
}

export interface PlanningAvailabilityStore {
  get(owner: LightTickOwner): Promise<PlanningAvailability | undefined>;
  save(owner: LightTickOwner, availability: PlanningAvailability): Promise<PlanningAvailability>;
}
