import { ApplicationError } from "../../../shared/errors.ts";

/** JSON integers must remain exact in both JavaScript and Flutter Web. */
export function creditMicrosInteger(value: string): number {
  const integer = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(integer)) {
    throw new ApplicationError(500, "AINOVEL_CREDITS_USAGE_INVALID", "Credit amount exceeds the safe integer transport range.");
  }
  return integer;
}
