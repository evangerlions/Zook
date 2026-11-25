import { ApplicationError } from "../../../shared/errors.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { PlanningAvailability } from "./planning-availability-store.ts";

export async function readPlanningAvailability(repository: LightTickRepository, owner: LightTickOwner): Promise<PlanningAvailability> {
  return await repository.planningAvailability.get(owner) ?? { available_weekdays: null, version: 0 };
}

/** Execute inside the owner-locked write that also records the retry receipt. */
export async function savePlanningAvailability(repository: LightTickRepository, owner: LightTickOwner, input: Record<string, unknown>) {
  const { available_weekdays: weekdays, base_version: version } = input;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0 ||
    Object.keys(input).some(key => key !== "available_weekdays" && key !== "base_version") ||
    (weekdays !== null && (!Array.isArray(weekdays) || weekdays.length > 7 ||
      weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7) || new Set(weekdays).size !== weekdays.length)))
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Choose distinct ISO weekdays from Monday (1) to Sunday (7).");
  const current = await readPlanningAvailability(repository, owner);
  if (current.version !== version)
    throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Review the current planning weekdays.");
  return repository.planningAvailability.save(owner, {
    available_weekdays: weekdays === null ? null : [...weekdays as number[]].sort((first, second) => first - second),
    version: version + 1,
  });
}

export async function readUnavailablePlanningDates(repository: LightTickRepository, owner: LightTickOwner, dates: string[]) {
  if (!dates.length) return [];
  const { available_weekdays } = await readPlanningAvailability(repository, owner);
  return unavailablePlanningDates(dates, available_weekdays);
}

/** Dates are already expressed as account-local YYYY-MM-DD. UTC here only calculates their calendar weekday. */
export function unavailablePlanningDates(dates: string[], weekdays: number[] | null): string[] {
  if (weekdays === null || weekdays.length === 7) return [];
  const available = new Set(weekdays);
  return [...new Set(dates)].filter(date => !available.has(new Date(date).getUTCDay() || 7)).sort();
}

export async function readUnavailableAgendaDates(repository: LightTickRepository, owner: LightTickOwner,
  businessDate: string, startsOn: string, endsOn: string) {
  const dates: string[] = [];
  const end = Date.parse(endsOn);
  for (let time = Date.parse(startsOn < businessDate ? businessDate : startsOn); time <= end; time += 86_400_000)
    dates.push(new Date(time).toISOString().slice(0, 10));
  return readUnavailablePlanningDates(repository, owner, dates);
}
