import { decimalInput, LedgerDecimal as D } from "../decimal.ts";
import { investmentId } from "../investment.service.ts";
import { fail, integer, keys, object, text } from "../../learning/native-learning.validation.ts";
import type { Allocation, Bucket } from "./bucket.types.ts";

export const BUCKET_LIMITS = { buckets: 20, allocations: 200, watch: 30, revisions: 500 };

function list<T>(raw: unknown, limit: number, parse: (value: unknown) => T, id: (row: T) => string) {
  if (!Array.isArray(raw) || raw.length > limit) fail(422, "Invalid bucket list or size.");
  const rows = raw.map(parse);
  if (new Set(rows.map(id)).size !== rows.length) fail(422, "Duplicate bucket or instrument assignment.");
  return rows;
}

function bucket(value: unknown): Bucket {
  const row = object(value);
  const common = { id: investmentId(row.id), name: text(row.name, 60, true).trim(), purpose: text(row.purpose, 500).trim() };
  if (row.kind === "holding") {
    keys(row, ["id", "name", "purpose", "kind", "target_weight"]);
    const target_weight = row.target_weight === null ? null : decimalInput(row.target_weight);
    if (target_weight !== null && new D(target_weight).gt(100)) fail(422, "Target weight must be 0–100 percent.");
    return { ...common, kind: "holding", target_weight };
  }
  if (row.kind === "watch") {
    keys(row, ["id", "name", "purpose", "kind", "instrument_ids", "assumption"]);
    return { ...common, kind: "watch",
      instrument_ids: list(row.instrument_ids, BUCKET_LIMITS.watch, investmentId, id => id),
      assumption: text(row.assumption, 2000).trim() };
  }
  fail(422, "Unknown bucket type.");
}

function allocation(value: unknown): Allocation {
  const row = object(value);
  keys(row, ["bucket_id", "instrument_id", "quantity"]);
  return {
    bucket_id: investmentId(row.bucket_id), instrument_id: investmentId(row.instrument_id),
    quantity: decimalInput(row.quantity, true),
  };
}

export function bucketInput(body: Record<string, unknown>) {
  keys(body, ["base_revision", "base_account_revision", "buckets", "allocations"]);
  const buckets = list(body.buckets, BUCKET_LIMITS.buckets, bucket, row => row.id);
  if (buckets.reduce((total, row) => total.plus(row.kind === "holding" ? row.target_weight ?? 0 : 0), new D(0)).gt(100))
    fail(422, "Combined target weights must not exceed 100 percent.");
  const allocations = list(body.allocations, BUCKET_LIMITS.allocations, allocation,
    row => row.bucket_id + "/" + row.instrument_id);
  const holdings = new Set(buckets.filter(row => row.kind === "holding").map(row => row.id));
  if (allocations.some(row => !holdings.has(row.bucket_id))) fail(422, "Only holding buckets may receive shares.");
  return {
    base_revision: integer(body.base_revision, 0, BUCKET_LIMITS.revisions),
    base_account_revision: integer(body.base_account_revision, 1, 2147483647),
    buckets, allocations,
  };
}
