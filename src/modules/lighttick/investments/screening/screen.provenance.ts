import { fail } from "../../learning/native-learning.validation.ts";
import { from, mul, compare } from "./screen.rational.ts";
import type { Condition } from "./screen.types.ts";
/** Preserve the legacy numeric/unit/window guard for a condition attributed to explicit source text. */
export function validateExplicit(c: Condition) {
  if (c.mapping.source !== "explicit" || c.field === "price_above_ma20") return;
  const quote = c.mapping.quote,
    clean = quote.replace(/(\d)\s*[-—–～]\s*(?=\d)/g, "$1~"),
    numbers: ReturnType<typeof from>[] = [];
  for (const m of clean.matchAll(
    /[+-]?\d+(?:\.\d+)?\s*(?:亿元|万元|亿|万|元|%|％|倍)?/g,
  )) {
    const end = m.index! + m[0].length;
    if (
      /^\s*(?:个)?(?:交易日|日|天)/.test(clean.slice(end)) ||
      clean.slice(Math.max(0, m.index! - 2), m.index).toUpperCase() === "MA"
    )
      continue;
    const value = m[0].match(/[+-]?\d+(?:\.\d+)?/)![0];
    numbers.push(
      mul(
        from(value),
        from(
          m[0].includes("亿")
            ? "100000000"
            : m[0].includes("万")
              ? "10000"
              : "1",
        ),
      ),
    );
  }
  const has = (v: string) => numbers.some((n) => compare(n, from(v)) === 0);
  if (
    numbers.length &&
    (!has(c.value) || (c.op === "between" && !has(c.upper_value!)))
  )
    fail(422, "Explicit threshold differs from quoted value/unit.");
  const range = numbers.length === 2 && /到|至|~|之间/.test(clean);
  if (
    range &&
    (c.op !== "between" ||
      compare(from(c.value), numbers[0]) !== 0 ||
      compare(from(c.upper_value!), numbers[1]) !== 0)
  )
    fail(422, "Preserve both quoted inclusive bounds.");
  if (numbers.length === 1 && c.op === "between")
    fail(422, "Do not invent a second explicit bound.");
  const lower = /至少|不低于|不少于|大于等于|以上/.test(quote),
    upper = /不超过|不高于|不大于|小于等于|以下/.test(quote);
  if (
    (lower && !upper && c.op !== "gte") ||
    (upper && !lower && c.op !== "lte")
  )
    fail(422, "Quoted inclusive operator differs.");
  if (
    !lower &&
    !upper &&
    ((/超过|大于|高于/.test(quote) && c.op !== "gt") ||
      (/低于|小于/.test(quote) && c.op !== "lt"))
  )
    fail(422, "Quoted strict operator differs.");
  const window = /近\s*(\d+)\s*(?:个)?(?:交易日|日|天)/.exec(quote),
    chosen = /_(\d+)d/.exec(c.field);
  if (window && chosen && window[1] !== chosen[1])
    fail(422, "Quoted window differs.");
}
