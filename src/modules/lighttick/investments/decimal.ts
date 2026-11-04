import { Decimal } from "decimal.js";
import { ApplicationError } from "../../../shared/errors.ts";
// Independent from any platform/provider Decimal defaults. Match the sealed legacy accounting context.
export const LedgerDecimal = Decimal.clone({
  defaults: true,
  minE: -10000,
  maxE: 10000,
  precision: 60,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -100,
  toExpPos: 100,
});
export function decimalInput(value: unknown, positive = false): string {
  const invalid = () => {
    throw new ApplicationError(
      422,
      "VALIDATION_ERROR",
      "Financial values must be decimal strings within the supported exponent boundary.",
    );
  };
  if (typeof value !== "string" || value.length > 120) invalid();
  const literal = (value as string).trim();
  if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(literal))
    invalid();
  const exponent = literal.match(/[eE]([-+]?\d+)$/)?.[1];
  if (exponent && Math.abs(Number(exponent)) > 1000) invalid();
  const amount = new LedgerDecimal(literal);
  if (
    !amount.isFinite() ||
    (amount.isNegative() && !amount.isZero()) ||
    (positive && !amount.gt(0)) ||
    amount.decimalPlaces() > 10 ||
    amount.abs().gte("1e18")
  )
    throw new ApplicationError(
      422,
      "VALIDATION_ERROR",
      "Financial decimal exceeds the nonnegative 28-digit/10-place boundary.",
    );
  return amount.toFixed();
}
export function decimalString(value: Decimal): string;
export function decimalString(value: null): null;
export function decimalString(value: Decimal | null): string | null;
export function decimalString(value: Decimal | null) {
  return value === null ? null : value.toFixed();
}
