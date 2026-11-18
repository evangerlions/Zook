import { projectLedger } from "../ledger.projection.ts";
import type { LedgerEvent } from "../ledger.types.ts";
import type { InvestmentRepository } from "../investment.types.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import { fail } from "../../learning/native-learning.validation.ts";
import { portfolioPage } from "../portfolio/portfolio.service.ts";
import type { Decision, JournalFill, JournalState } from "./journal.types.ts";

export const currentDecisions = (state: JournalState) => Object.values(state.decisions).map(history => history.at(-1)!);
export const reviewedDecision = (row: Decision, state: JournalState) =>
  state.reviews[row.id]?.some(review => review.decision_revision === row.revision) ?? false;

export function decisionSummary(row: Decision, state: JournalState) {
  const { id, instrument_id, action, reason, occurred_at, review_on, backfilled, revision, evidence } = row;
  return { id, instrument_id, action, reason, occurred_at, review_on, backfilled, revision,
    evidence, reviewed: reviewedDecision(row, state), fill_count: row.event_ids.length };
}

export function journalFills(events: LedgerEvent[]): JournalFill[] {
  const projection = projectLedger(events);
  return events.filter(event => event.input.kind !== "correction").map(original => {
    let current = original.id;
    while (projection.superseded.has(current)) current = projection.superseded.get(current)!;
    return { original, effective: { id: current, input: projection.current.get(current) ?? null } };
  });
}

export function matchesInstrument(row: JournalFill, id: string) {
  const original = row.original.input, effective = row.effective.input;
  return (original.kind === "fill" && original.fill.instrument_id === id)
    || (effective?.kind === "fill" && effective.fill.instrument_id === id);
}

export async function journalTimeline(
  repo: InvestmentRepository,
  owner: LightTickOwner,
  state: JournalState,
  id: string,
  kind: string,
  cursor: string,
  limit: number,
) {
  if (!["all", "research", "decision", "fill", "review"].includes(kind)) fail(422, "Invalid timeline filter.");
  const instrument = await repo.instrument(owner, id);
  if (!instrument) fail(404, "Instrument was not found.");
  const decisions = currentDecisions(state).filter(row => row.instrument_id === id);
  const rows = [];
  if (kind === "all" || kind === "research")
    for (const research of await repo.research.list(owner, id))
      rows.push({ kind: "research" as const, resource_id: research.id, occurred_at: research.updated_at, research });

  if (kind === "all" || kind === "decision")
    for (const row of decisions)
      rows.push({ kind: "decision" as const, resource_id: row.id, occurred_at: row.occurred_at, decision: decisionSummary(row, state) });

  if (kind === "all" || kind === "review")
    for (const row of decisions)
      for (const review of state.reviews[row.id] ?? [])
        rows.push({ kind: "review" as const, resource_id: review.id, occurred_at: review.recorded_at, review });

  if (kind === "all" || kind === "fill") {
    let eventCount = 0;
    for (const account of await repo.ledger.accountsForInstrument(owner, id)) {
      const events = await repo.ledger.events(owner, account);
      eventCount += events.length;
      if (events.length > 10000 || eventCount > 50000) fail(413, "Timeline exceeds the bounded ledger history.");
      for (const fill of journalFills(events)) {
        if (!matchesInstrument(fill, id)) continue;
        rows.push({ kind: "fill" as const, resource_id: fill.original.id,
          occurred_at: fill.effective.input?.business_date ?? fill.original.input.business_date, fill });
      }
    }
  }
  const ordered = rows.map(row => ({
    ...row,
    id: String(300000000000000 - Date.parse(row.occurred_at.length === 10
      ? row.occurred_at + "T00:00:00+08:00" : row.occurred_at)).padStart(15, "0") + "/" + row.kind + "/" + row.resource_id,
  }));
  return { instrument, following: state.watchlist.includes(id), ...portfolioPage(owner, "journal/" + id + "/" + kind, ordered, cursor, limit) };
}
