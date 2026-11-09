import { validateExplicit } from "./screen.provenance.ts";
import { investmentId } from "../investment.service.ts";
import { marketDate } from "../market/market.validation.ts";
import {
  object,
  keys,
  text,
  integer,
  fail,
  digest,
} from "../../learning/native-learning.validation.ts";
import { numeric, from, compare } from "./screen.rational.ts";
import {
  SCREEN_FIELDS,
  type Mapping,
  type RuleFields,
  type TemplateFields,
  type Recipe,
  type Definition,
  type SecurityStatus,
} from "./screen.types.ts";
function bool(v: unknown) {
  if (typeof v !== "boolean") fail(422, "Explicit boolean required.");
  return v;
}
export function mapping(v: unknown, source: string): Mapping {
  const b = object(v);
  keys(b, ["source", "quote", "reason"]);
  if (
    !["manual", "explicit", "default", "suggested"].includes(String(b.source))
  )
    fail(422, "Unknown condition provenance.");
  const quote = text(b.quote, 500),
    reason = text(b.reason, 500);
  if (quote && !source.includes(quote))
    fail(422, "Condition quote is outside reviewed source text.");
  if (b.source === "explicit" && !quote)
    fail(422, "Explicit source requires a quote.");
  if (b.source === "suggested" && !reason)
    fail(422, "Suggested condition requires an explanation.");
  return { source: b.source as Mapping["source"], quote, reason };
}
export function ruleFields(v: unknown): RuleFields {
  const b = object(v);
  keys(b, [
    "name",
    "description",
    "source_text",
    "conditions",
    "combine",
    "sort_by",
    "descending",
    "secondary_sort_by",
    "secondary_descending",
    "limit",
    "recipe",
    "sort_mapping",
  ]);
  const source_text = text(b.source_text, 2000);
  if (!Array.isArray(b.conditions) || b.conditions.length > 10)
    fail(422, "At most ten bounded conditions required.");
  const conditions = b.conditions.map((v) => {
    const c = object(v);
    keys(c, ["field", "op", "value", "upper_value", "mapping"]);
    if (
      !Object.hasOwn(SCREEN_FIELDS, String(c.field)) ||
      !["eq", "ne", "gt", "gte", "lt", "lte", "between"].includes(String(c.op))
    )
      fail(422, "Unknown screening condition.");
    let value: string,
      upper_value: string | null = null;
    if (c.field === "price_above_ma20") {
      if (
        !["eq", "ne"].includes(String(c.op)) ||
        !["true", "false"].includes(String(c.value)) ||
        c.upper_value !== null
      )
        fail(422, "MA20 condition requires a boolean comparison.");
      value = String(c.value);
    } else {
      value = numeric(c.value);
      if (c.op === "between") {
        upper_value = numeric(c.upper_value);
        if (compare(from(value), from(upper_value)) > 0)
          fail(422, "Inverted inclusive range.");
      } else if (c.upper_value !== null)
        fail(422, "Upper value only applies to inclusive range.");
    }
    return {
      field: String(c.field),
      op: c.op as RuleFields["conditions"][number]["op"],
      value,
      upper_value,
      mapping: mapping(c.mapping, source_text),
    };
  });
  if (
    !["all", "any"].includes(String(b.combine)) ||
    !Object.hasOwn(SCREEN_FIELDS, String(b.sort_by)) ||
    (b.secondary_sort_by !== null &&
      !Object.hasOwn(SCREEN_FIELDS, String(b.secondary_sort_by)))
  )
    fail(422, "Unknown combine or sort field.");
  conditions.forEach(validateExplicit);
  return {
    name: text(b.name, 100, true),
    description: text(b.description, 2000),
    source_text,
    conditions,
    combine: b.combine as "all" | "any",
    sort_by: String(b.sort_by),
    descending: bool(b.descending),
    secondary_sort_by:
      b.secondary_sort_by === null ? null : String(b.secondary_sort_by),
    secondary_descending: bool(b.secondary_descending),
    limit: integer(b.limit, 1, 20),
    recipe: b.recipe === null ? null : recipe(b.recipe),
    sort_mapping: mapping(b.sort_mapping, source_text),
  };
}
export function recipe(v: unknown): Recipe {
  const b = object(v);
  keys(b, [
    "kind",
    "window",
    "minimum_gain",
    "volume_ratio",
    "shrink_ratio",
    "pullback_min",
    "pullback_max",
    "near_high_ratio",
    "exclude_st",
    "exclude_suspended",
  ]);
  if (
    !["ma_bullish", "pullback", "volume_breakout", "return_window"].includes(
      String(b.kind),
    )
  )
    fail(422, "Unknown built-in recipe.");
  const numbers = {} as Pick<
    Recipe,
    | "minimum_gain"
    | "volume_ratio"
    | "shrink_ratio"
    | "pullback_min"
    | "pullback_max"
    | "near_high_ratio"
  >;
  for (const k of [
    "minimum_gain",
    "volume_ratio",
    "shrink_ratio",
    "pullback_min",
    "pullback_max",
    "near_high_ratio",
  ] as const) {
    const n = numeric(b[k]);
    if (compare(from(n), from("0")) < 0 || compare(from(n), from("1000")) > 0)
      fail(422, "Recipe parameter exceeds 0..1000.");
    numbers[k] = n;
  }
  if (
    compare(from(numbers.pullback_min), from(numbers.pullback_max)) > 0 ||
    compare(from(numbers.near_high_ratio), from("0")) <= 0 ||
    compare(from(numbers.near_high_ratio), from("1")) > 0
  )
    fail(422, "Invalid pullback/high interval.");
  return {
    ...numbers,
    kind: b.kind as Recipe["kind"],
    window: integer(b.window, 5, 120),
    exclude_st: bool(b.exclude_st),
    exclude_suspended: bool(b.exclude_suspended),
  };
}
export function templateFields(v: unknown): TemplateFields {
  const b = object(v);
  keys(b, [
    "name",
    "description",
    "rule",
    "instrument_ids",
    "account_id",
    "enabled",
    "tags",
  ]);
  const ref = object(b.rule);
  keys(ref, ["id", "version", "definition_digest"]);
  if (
    typeof ref.definition_digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(ref.definition_digest)
  )
    fail(422, "Exact rule digest required.");
  if (
    !Array.isArray(b.instrument_ids) ||
    b.instrument_ids.length < 1 ||
    b.instrument_ids.length > 20
  )
    fail(422, "Select 1..20 explicit instruments.");
  const instrument_ids = b.instrument_ids.map(investmentId);
  if (new Set(instrument_ids).size !== instrument_ids.length)
    fail(422, "Duplicate pool identity.");
  if (!Array.isArray(b.tags) || b.tags.length > 10)
    fail(422, "At most ten tags supported.");
  return {
    name: text(b.name, 100, true),
    description: text(b.description, 2000),
    rule: {
      id: investmentId(ref.id),
      version: integer(ref.version, 1, 100),
      definition_digest: ref.definition_digest,
    },
    instrument_ids,
    account_id: b.account_id === null ? null : investmentId(b.account_id),
    enabled: bool(b.enabled),
    tags: b.tags.map((v) => text(v, 50, true)),
  };
}
export const definitionDigest = (d: Definition) => digest(d.fields);
export function timestamp(v: unknown) {
  const s = text(v, 40, true);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      s,
    ) ||
    !Number.isFinite(Date.parse(s))
  )
    fail(422, "Explicit timestamp with timezone required.");
  marketDate(s.slice(0, 10));
  return s;
}
export function securityStatus(
  v: unknown,
  on: string,
  decision: string,
): SecurityStatus | null {
  if (v === null) return null;
  const b = object(v);
  keys(b, ["as_of", "is_st", "suspended", "source_label", "available_at"]);
  if (b.as_of !== on)
    fail(422, "Security status must match selected data date.");
  for (const k of ["is_st", "suspended"])
    if (b[k] !== null && typeof b[k] !== "boolean")
      fail(422, "Security status is boolean or unknown.");
  const available_at = timestamp(b.available_at);
  if (Date.parse(available_at) > Date.parse(decision))
    fail(422, "Status not known at decision time.");
  return {
    as_of: on,
    is_st: b.is_st as boolean | null,
    suspended: b.suspended as boolean | null,
    source_label: text(b.source_label, 300, true),
    available_at,
  };
}
