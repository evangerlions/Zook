import { ApplicationError } from "../../../shared/errors.ts";
import { todayDateAt } from "../lighttick-today.service.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";
import { readPlanningAgenda } from "./planning-agenda.ts";

export function plannedRestDate(value: unknown): string {
  if (!dateOnly(value) || value.startsWith("0000"))
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Choose a valid calendar date.");
  return value;
}

export async function readPlannedRest(repository: LightTickRepository, owner: LightTickOwner, now: Date, date: string) {
  return repository.transaction(owner, async () => {
    const rest = await repository.plannedRest.get(owner, date);
    const agenda = await readPlanningAgenda(repository, owner, now, { starts_on: date, ends_on: date });
    return { date, planned_rest: rest?.planned_rest ?? false, version: rest?.version ?? 0, scheduled_action_count: agenda.items.length };
  });
}

/** Execute inside the owner-locked write that also records the retry receipt. */
export async function savePlannedRest(repository: LightTickRepository, owner: LightTickOwner, now: Date, input: Record<string, unknown>) {
  const date = plannedRestDate(input.date);
  if (typeof input.planned_rest !== "boolean" || typeof input.base_version !== "number" ||
    !Number.isSafeInteger(input.base_version) || input.base_version < 0 ||
    Object.keys(input).some(key => !["date", "planned_rest", "base_version"].includes(key)))
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Review the rest choice and date version.");
  const { businessDate } = todayDateAt(now, (await repository.getProfile(owner))?.timezone ?? "UTC");
  if (date < businessDate)
    throw new ApplicationError(422, "REQ_FIELD_INVALID", "Past calendar dates are read-only.");
  const current = await repository.plannedRest.get(owner, date);
  if ((current?.version ?? 0) !== input.base_version)
    throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "The rest choice changed. Review the current date.");
  await repository.plannedRest.save(owner, { date, planned_rest: input.planned_rest, version: input.base_version + 1 });
  return readPlannedRest(repository, owner, now, date);
}

export async function readPlannedRestDates(repository: LightTickRepository, owner: LightTickOwner, dates: string[]) {
  const selected = [...new Set(dates)].sort();
  if (!selected.length) return [];
  const marked = await repository.plannedRest.list(owner, selected[0]!, selected.at(-1)!);
  const requested = new Set(selected);
  return marked.filter(date => requested.has(date));
}
