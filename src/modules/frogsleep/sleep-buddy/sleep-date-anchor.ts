import { badRequest } from "../../../shared/errors.ts";
import { parseIsoTimestamp } from "../frogsleep-validation.ts";

/** Normalizes native calendar-day anchors and legacy ISO timestamps to one shared night key. */
export function sleepDateAnchor(value?: string) {
  const input = value || new Date().toISOString();
  const day = input.slice(0, 10);
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== day) {
    badRequest("REQ_INVALID_BODY", "date_anchor must identify a valid calendar day.");
  }
  if (input.length > 10) parseIsoTimestamp(input, "date_anchor");
  return day;
}
