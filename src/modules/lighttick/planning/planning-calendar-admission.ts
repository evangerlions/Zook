import { ApplicationError } from "../../../shared/errors.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner, LightTickTaskRow } from "../lighttick.types.ts";
import { taskScheduledDate } from "../lighttick-today.service.ts";
import { readPlannedRestDates } from "./planned-rest.ts";
import { readUnavailablePlanningDates } from "./planning-availability.ts";

export async function readCalendarConflicts(repository: LightTickRepository, owner: LightTickOwner,
  candidates: readonly { date?: string; id?: string }[], timezone: string, existing?: LightTickTaskRow[]) {
  const dates = candidates.flatMap(item => item.date ? [item.date] : []);
  const restDates = await readPlannedRestDates(repository, owner, dates);
  const unavailableDates = await readUnavailablePlanningDates(repository, owner, dates);
  const protectedDates = new Set([...restDates, ...unavailableDates]);
  if (!protectedDates.size) return { planned_rest_dates: restDates, unavailable_dates: unavailableDates };
  const blocked = new Set<string>();
  const byId = existing && new Map(existing.map(task => [task.id, task]));
  for (const item of candidates) {
    if (!item.date || !protectedDates.has(item.date) || blocked.has(item.date)) continue;
    const current = item.id ? (byId ? byId.get(item.id) : await repository.getTask(owner, item.id)) : undefined;
    if (!current || !["pending", "in_progress"].includes(current.status) || taskScheduledDate(current, timezone) !== item.date)
      blocked.add(item.date);
  }
  return {
    planned_rest_dates: restDates.filter(date => blocked.has(date)),
    unavailable_dates: unavailableDates.filter(date => blocked.has(date)),
  };
}

export function assertAvailableCalendarDates({ planned_rest_dates, unavailable_dates }: Awaited<ReturnType<typeof readCalendarConflicts>>) {
  if (planned_rest_dates.length)
    throw new ApplicationError(422, "LIGHTTICK_PLANNED_REST_CONFLICT", "Move the new work to another date or clear the planned rest.",
      { planned_rest_dates });
  if (unavailable_dates.length)
    throw new ApplicationError(422, "LIGHTTICK_UNAVAILABLE_PLANNING_DAY", "Move the new work to an available weekday or update your planning weekdays.",
      { unavailable_dates });
}
