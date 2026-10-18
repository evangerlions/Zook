import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityFilter } from "../../../shared/types/frogsleep-entity-filter.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

export type CompletionFact = { id: string; userId: string; kind: "focus" | "sleep" | "encouragement";
  startsAt: string; occurredAt: string; minutes: number };

/** Reads terminal source records; uploaded amounts and partner summaries never manufacture completion. */
export async function completionFacts(database: ApplicationDatabase, relationship: FrogSleepEntityRecord, userId: string) {
  const focus = relationship.kind === "focus_relationship";
  const records = await allBuddyRecords(database, { kind: focus ? "focus_session" : "sleep_session",
    ...(focus ? { ownerUserId: userId } : { relationshipId: relationship.id }) });
  const facts: CompletionFact[] = [];
  for (const record of records) {
    const start = record.startsAt ?? record.createdAt;
    if (focus) {
      const elapsed = (Date.parse(record.endsAt ?? "") - Date.parse(start)) / 60_000;
      const minutes = Math.min(elapsed, Number(record.payload.actual_minutes ?? record.payload.minutes ?? 0));
      if (record.status !== "completed" || !Number.isFinite(minutes) || minutes <= 0 ||
        Date.parse(record.endsAt!) > Date.now()) continue;
      const id = String(record.payload.client_session_id ?? `${record.startsAt}|${record.endsAt}`);
      if (!facts.some(fact => fact.id === id)) facts.push({ id, userId, kind: "focus", startsAt: start,
        occurredAt: record.endsAt!, minutes });
    } else {
      const states = record.payload.participantStates as Record<string, unknown> | undefined;
      if (states?.[userId] !== "morning_completed") continue;
      const events = await allBuddyRecords(database, { kind: "sleep_event", sessionId: record.id,
        ownerUserId: userId, status: "morning_completed" });
      const occurredAt = events.map(event => event.occurredAt ?? event.createdAt).sort()[0];
      if (!occurredAt || occurredAt < start || Date.parse(occurredAt) > Date.now()) continue;
      facts.push({ id: record.id, userId, kind: "sleep", startsAt: start, occurredAt, minutes: 0 });
    }
  }
  const interactions = await allBuddyRecords(database, { kind: "buddy_interaction", ownerUserId: userId,
    relationshipId: relationship.id, status: "sent" });
  return [...facts, ...interactions.map(record => ({ id: record.id, userId, kind: "encouragement" as const,
    startsAt: record.createdAt, occurredAt: record.createdAt, minutes: 0 }))];
}

export async function allBuddyRecords(database: ApplicationDatabase, filter: Omit<FrogSleepEntityFilter, "appId">) {
  const records: FrogSleepEntityRecord[] = [];
  let before: FrogSleepEntityFilter["before"];
  while (true) {
    const page = await database.listFrogSleepEntities({ ...filter, appId: FROGSLEEP_APP_ID, before, limit: 500 });
    records.push(...page);
    if (page.length < 500) return records;
    const last = page.at(-1)!;
    before = { t: last.occurredAt ?? last.startsAt ?? last.createdAt, id: last.id };
  }
}

export function goalProgress(facts: CompletionFact[], type: string, timezone: string, from: string, to: string) {
  const kind = type === "sleep_schedule_days" ? "sleep" : type === "daily_encouragement" ? "encouragement" : "focus";
  const eligible = facts.filter(fact => fact.kind === kind && fact.startsAt >= from && fact.occurredAt < to);
  if (type === "focus_minutes") return eligible.reduce((sum, fact) => sum + fact.minutes, 0);
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  return new Set(eligible.map(fact => format.format(new Date(fact.occurredAt)))).size;
}
