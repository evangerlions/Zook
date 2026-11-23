import { businessDay, date } from "../../actions/action.validation.ts";
import { fail, integer, keys, object, text } from "../../learning/native-learning.validation.ts";
import { investmentId } from "../investment.service.ts";
import { decisionActions, decisionReviewStatuses, reviewOutcomes,
  type DecisionFields, type DecisionReview, type EvidenceReference } from "./journal.types.ts";

export const shanghaiDay = (instant: string) => businessDay(new Date(instant), "Asia/Shanghai");

export function choice<T extends string>(value: unknown, options: readonly T[], field: string): T {
  const selected = options.find(option => option === value);
  if (selected === undefined) fail(422, `Invalid ${field}.`);
  return selected;
}

function unique<T>(raw: unknown, parse: (item: unknown) => T, identity: (item: T) => string): T[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 30) fail(422, "At most 30 references per field are supported.");
  const items = raw.map(parse);
  if (new Set(items.map(identity)).size !== items.length) fail(422, "References cannot repeat.");
  return items;
}

export function evidenceReference(raw: unknown): EvidenceReference {
  const row = object(raw);
  keys(row, ["kind", "id", "revision"]);
  return {
    kind: choice(row.kind, ["research", "material"], "evidence type"),
    id: investmentId(row.id),
    revision: integer(row.revision, 1, 500),
  };
}

export function decisionInput(body: Record<string, unknown>): { base: number; fields: DecisionFields } {
  keys(body, ["base_revision", "instrument_id", "action", "reason", "occurred_at", "account_id", "review_on",
    "counterevidence", "trigger", "target_weight", "evidence", "event_ids"]);
  const raw = body.occurred_at;
  let occurred = null;
  if (raw != null) {
    const value = text(raw, 40, true);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value)
      || !Number.isFinite(Date.parse(value))) fail(422, "Provide a valid decision time with timezone.");
    date(value.slice(0, 10));
    if (value.slice(11, 13) > "23") fail(422, "Invalid decision hour.");
    occurred = new Date(value).toISOString();
  }
  const weight = body.target_weight ?? null;
  if (weight !== null && (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 100))
    fail(422, "Target weight must be between 0 and 100 percent.");
  return {
    base: integer(body.base_revision, 0, 99),
    fields: {
      instrument_id: investmentId(body.instrument_id),
      action: choice(body.action, decisionActions, "decision action"),
      reason: text(body.reason, 2000, true).trim(),
      occurred_at: occurred,
      account_id: body.account_id == null ? null : investmentId(body.account_id),
      review_on: body.review_on == null ? null : date(body.review_on),
      counterevidence: body.counterevidence === undefined ? "" : text(body.counterevidence, 2000).trim(),
      trigger: body.trigger === undefined ? "" : text(body.trigger, 2000).trim(),
      target_weight: weight,
      evidence: unique(body.evidence, evidenceReference, r => r.kind + "/" + r.id),
      event_ids: unique(body.event_ids, investmentId, id => id),
    },
  };
}

export function reviewInput(body: Record<string, unknown>): Omit<DecisionReview, "id" | "decision_id" | "recorded_at"> {
  keys(body, ["decision_revision", "thesis_outcome", "execution", "result", "next_step"]);
  return {
    decision_revision: integer(body.decision_revision, 1, 100),
    thesis_outcome: choice(body.thesis_outcome, reviewOutcomes, "thesis outcome"),
    execution: choice(body.execution, ["followed", "deviated", "not_applicable"], "execution outcome"),
    result: text(body.result, 3000, true).trim(),
    next_step: text(body.next_step, 2000, true).trim(),
  };
}

export function decisionHistoryInput(query: Record<string, string | undefined>) {
  keys(query, ["q", "instrument_id", "action", "review_status", "outcome", "from", "to", "cursor", "limit"]);
  const from = query.from === undefined ? null : date(query.from);
  const to = query.to === undefined ? null : date(query.to);
  if (from && to && from > to) fail(422, "The first decision date must not follow the last date.");
  return {
    filters: {
      from, to,
      term: query.q === undefined ? "" : text(query.q, 120).trim().toLowerCase(),
      instrumentId: query.instrument_id === undefined ? null : investmentId(query.instrument_id),
      action: query.action === undefined ? null : choice(query.action, decisionActions, "decision action"),
      reviewStatus: query.review_status === undefined ? null : choice(query.review_status, decisionReviewStatuses, "review status"),
      outcome: query.outcome === undefined ? null : choice(query.outcome, reviewOutcomes, "thesis outcome"),
    },
    cursor: query.cursor ?? "",
    limit: query.limit === undefined ? 20 : integer(Number(query.limit), 1, 100),
  };
}
