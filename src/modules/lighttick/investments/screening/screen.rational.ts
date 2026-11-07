import { LedgerDecimal as D } from "../decimal.ts";
import { fail } from "../../learning/native-learning.validation.ts";
export type Rational = { n: bigint; d: bigint };
const abs = (n: bigint) => (n < 0n ? -n : n);
export function rational(n: bigint, d = 1n): Rational {
  if (!d) throw Error("ZERO_DENOMINATOR");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  let a = abs(n),
    b = d;
  while (b) {
    const v = a % b;
    a = b;
    b = v;
  }
  return { n: n / (a || 1n), d: d / (a || 1n) };
}
export function numeric(v: unknown): string {
  if (
    typeof v !== "string" ||
    v.length > 100 ||
    !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(v.trim())
  )
    fail(422, "Finite decimal string required.");
  const exponent = v.match(/e([-+]?\d+)$/i)?.[1];
  if (exponent && Math.abs(Number(exponent)) > 60)
    fail(422, "Threshold exponent exceeds capacity.");
  const x = new D(v);
  if (!x.isFinite() || x.abs().gte("1e20") || x.decimalPlaces() > 60)
    fail(422, "Threshold outside exact decimal range.");
  return x.toFixed();
}
export function from(v: unknown): Rational {
  const s = numeric(v),
    negative = s.startsWith("-"),
    [a, b = ""] = s.replace(/^[-+]/, "").split(".");
  return rational(
    BigInt(a + b) * (negative ? -1n : 1n),
    10n ** BigInt(b.length),
  );
}
export const add = (a: Rational, b: Rational) =>
  rational(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rational, b: Rational) =>
  rational(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rational, b: Rational) => rational(a.n * b.n, a.d * b.d);
export const div = (a: Rational, b: Rational) => rational(a.n * b.d, a.d * b.n);
export const compare = (a: Rational, b: Rational) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
export const sum = (a: Rational[]) => a.reduce(add, rational(0n));
export const mean = (a: Rational[]) => div(sum(a), rational(BigInt(a.length)));
export function display(v: Rational) {
  const scaled = (abs(v.n) * 10n ** 28n) / v.d,
    whole = scaled / 10n ** 28n,
    tail = (scaled % 10n ** 28n)
      .toString()
      .padStart(28, "0")
      .replace(/0+$/, "");
  return (v.n < 0n && scaled ? "-" : "") + whole + (tail ? "." + tail : "");
}
