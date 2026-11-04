import { Decimal } from "decimal.js";
import { ApplicationError } from "../../../shared/errors.ts";
// Independent from any platform/provider Decimal defaults. Match the sealed legacy accounting context.
export const LedgerDecimal = Decimal.clone({
  precision: 60,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -100,
  toExpPos: 100,
});
export function decimalInput(value: unknown, positive = false): string {
  if (
    typeof value !== "string" ||
    value.length > 120 ||
    !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(value)
  )
    throw new ApplicationError(
      422,
      "VALIDATION_ERROR",
      "Financial values must be decimal strings.",
    );
  const amount = new LedgerDecimal(value);
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
