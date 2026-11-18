import { LedgerDecimal as D, decimalString as str } from "../decimal.ts";
import type { LedgerEvent } from "../ledger.types.ts";
import type { InvestmentAccount } from "../investment.types.ts";
import { financialDigest } from "../portfolio/portfolio.engine.ts";
import type { PortfolioFact, SavedValuation } from "../portfolio/portfolio.types.ts";
import type { Allocation, BucketHolding, BucketMetric, BucketSnapshot, BucketView } from "./bucket.types.ts";

export function allocationTotals(rows: Allocation[]) {
  const totals = new Map<string, InstanceType<typeof D>>();
  for (const row of rows) totals.set(row.instrument_id, (totals.get(row.instrument_id) ?? new D(0)).plus(row.quantity));
  return totals;
}

type Snapshot = { account: InvestmentAccount; events: LedgerEvent[]; facts: PortfolioFact[] };
function markBasis(context: Snapshot, positions: Map<string, string>, saved?: SavedValuation) {
  if (!saved) return null;
  const { output } = saved;
  const candidate = { id: saved.id, date: output.date };
  if (financialDigest(context, output.date) !== output.ledger_digest)
    return { ...candidate, status: "stale" as const, usable: false };
  const valued = output.balance.positions.filter(row => new D(row.quantity).gt(0));
  if (valued.length !== positions.size || valued.some(row => !positions.has(row.instrument_id)
    || !new D(row.quantity).eq(positions.get(row.instrument_id)!))) {
    return { ...candidate, status: "holdings_changed" as const, usable: false };
  }
  return { ...candidate, status: "available" as const, usable: true };
}

type QuantityRow = { instrument_id: string; quantity: string };
type MetricRow = { quantity: string; price: string | null };
function valueRows(rows: MetricRow[]) {
  const priced = rows.filter(row => row.price !== null);
  const total = priced.reduce((value, row) => value.plus(new D(row.quantity).times(row.price!)), new D(0));
  return {
    coverage: { available: priced.length, required: rows.length },
    value: priced.length === rows.length ? total : null,
  };
}

function metric(rows: MetricRow[], denominator: InstanceType<typeof D> | null, target: string | null): BucketMetric {
  const { value, coverage } = valueRows(rows);
  const actual = value && denominator?.gt(0) ? value.div(denominator).times(100) : null;
  return {
    coverage,
    market_value: str(value),
    actual_weight: str(actual?.toDecimalPlaces(6) ?? null),
    deviation: str(actual !== null && target !== null ? actual.minus(target).toDecimalPlaces(6) : null),
  };
}

export function projectBuckets(
  context: Snapshot,
  journal: BucketSnapshot,
  positions: Map<string, string>,
  saved: SavedValuation | undefined,
  cash: string | null,
): Omit<BucketView, "snapshot" | "account_revision" | "history"> {
  const unverified = new Set(context.facts.filter(fact => fact.kind === "notice" && fact.status === "open").map(fact => fact.instrument_id));
  const basis = markBasis(context, positions, saved);
  const totals = allocationTotals(journal.allocations);
  const ids = [...new Set([...positions.keys(), ...totals.keys(), ...unverified])].sort();
  const marks = new Map(basis?.usable ? saved!.output.quotes.flatMap(q => q.status === "available" && q.selected
    ? [[q.instrument_id, q.selected.price] as const] : []) : []);
  const holdings: BucketHolding[] = ids.map(instrument_id => {
    const quantity = positions.get(instrument_id) ?? "0";
    const allocated = totals.get(instrument_id) ?? new D(0);
    const remaining = new D(quantity).minus(allocated);
    return {
      instrument_id, quantity, allocated: str(allocated),
      unallocated: remaining.lt(0) || unverified.has(instrument_id) ? null : str(remaining),
      excess: str(D.max(remaining.negated(), 0)),
      quantity_verified: !unverified.has(instrument_id),
      price: unverified.has(instrument_id) ? null : marks.get(instrument_id) ?? null,
    };
  });
  const byId = new Map(holdings.map(row => [row.instrument_id, row]));
  const held = holdings.filter(row => new D(row.quantity).gt(0));
  const holdingsValue = valueRows(held).value;
  const needsReview = unverified.size > 0 || holdings.some(row => new D(row.excess).gt(0));
  const denominator = basis?.usable && !needsReview ? holdingsValue : null;
  const forAllocation = (row: QuantityRow): MetricRow => {
    const holding = byId.get(row.instrument_id);
    return { quantity: row.quantity, price: holding?.unallocated === null ? null : holding?.price ?? null };
  };
  const metrics = Object.fromEntries(journal.buckets.flatMap(bucket => bucket.kind === "holding"
    ? [[bucket.id, metric(journal.allocations.filter(row => row.bucket_id === bucket.id).map(forAllocation), denominator, bucket.target_weight)]]
    : []));
  const unallocated = metric(holdings.filter(row => row.unallocated !== "0")
    .map(row => ({ quantity: row.unallocated ?? "0", price: row.unallocated === null ? null : row.price })), denominator, null);
  const valuation = basis ? { id: basis.id, date: basis.date,
    status: basis.usable && (holdingsValue === null || unverified.size > 0) ? "partial" as const : basis.status } : null;
  return { holdings, metrics, unallocated, valuation,
    holdings_value: basis?.usable && !unverified.size ? str(holdingsValue) : null,
    unallocated_cash: unverified.size ? null : cash, needs_review: needsReview };
}
