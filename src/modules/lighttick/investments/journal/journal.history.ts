import type { LightTickOwner } from "../../lighttick.types.ts";
import { digest } from "../../learning/native-learning.validation.ts";
import type { InvestmentRepository } from "../investment.types.ts";
import { portfolioPage } from "../portfolio/portfolio.service.ts";
import { currentDecisions, decisionSummary, journalOrderKey } from "./journal.timeline.ts";
import type { JournalState } from "./journal.types.ts";
import { shanghaiDay, type decisionHistoryInput } from "./journal.validation.ts";

export async function journalHistory(repo: InvestmentRepository, owner: LightTickOwner, state: JournalState,
  input: ReturnType<typeof decisionHistoryInput>, today: string) {
  const { filters, cursor, limit } = input;
  const instruments = new Map((await repo.instruments(owner)).map(instrument => [instrument.id, instrument]));
  const rows = [];
  for (const row of currentDecisions(state)) {
    if (filters.instrumentId && row.instrument_id !== filters.instrumentId || filters.action && row.action !== filters.action) continue;
    if (filters.from || filters.to) {
      const day = shanghaiDay(row.occurred_at);
      if (filters.from && day < filters.from || filters.to && day > filters.to) continue;
    }
    const decision = decisionSummary(row, state);
    const reviewStatus = decision.reviewed ? "reviewed" : decision.review_on && decision.review_on <= today ? "due" : "pending";
    if (filters.reviewStatus === "pending" ? decision.reviewed : filters.reviewStatus && filters.reviewStatus !== reviewStatus) continue;

    const reviews = state.reviews[row.id] ?? [];
    const latest = reviews.at(-1);
    if (filters.outcome && latest?.thesis_outcome !== filters.outcome) continue;

    const instrument = instruments.get(row.instrument_id);
    if (filters.term) {
      const matches = (value: string | undefined) => value?.toLowerCase().includes(filters.term);
      const fields = [instrument?.name, instrument?.code, row.reason, row.counterevidence, row.trigger];
      if (!fields.some(matches) && !reviews.some(review => matches(review.result) || matches(review.next_step))) continue;
    }
    rows.push({
      id: journalOrderKey(row.occurred_at, row.id),
      entry: {
        decision: { ...decision, instrument_name: instrument?.name ?? row.instrument_id },
        instrument_code: instrument?.code ?? null,
        review_status: reviewStatus,
        latest_review: latest ? {
          decision_revision: latest.decision_revision,
          thesis_outcome: latest.thesis_outcome,
          recorded_at: latest.recorded_at,
        } : null,
      },
    });
  }
  const page = portfolioPage(owner, "journal/decisions/" + digest(filters), rows, cursor, limit);
  return { ...page, items: page.items.map(row => row.entry) };
}
