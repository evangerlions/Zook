import { ApplicationError } from "../../shared/errors.ts";
import { parseAlipayMoney } from "./alipay-policy.ts";

export interface AlipayFullRefund {
  amountMinor: number;
  refundedAt: string;
}

/** Alipay sends provider timestamps in China Standard Time. */
export function readAlipayFullRefund(
  evidence: Record<string, unknown>, amountMinor: number, earliestAt: string, now: Date,
): AlipayFullRefund | undefined {
  if (evidence.trade_status !== "TRADE_CLOSED" || evidence.refund_fee === undefined || evidence.refund_fee === "") return;
  const refundAmount = parseAlipayMoney(evidence.refund_fee);
  if (refundAmount === undefined || refundAmount > amountMinor) rejectRefund();
  if (refundAmount === 0 || refundAmount < amountMinor) return;

  const providerTime = evidence.gmt_refund;
  const parts = typeof providerTime === "string"
    ? /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/.exec(providerTime) : null;
  if (!parts) rejectRefund();
  const localTime = `${parts[1]}T${parts[2]}.${(parts[3] ?? "").padEnd(3, "0")}`;
  const timestamp = Date.parse(localTime + "+08:00");
  if (!Number.isFinite(timestamp) ||
    new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, -1) !== localTime ||
    timestamp < Date.parse(earliestAt) || timestamp > now.getTime() + 300_000) rejectRefund();
  return { amountMinor: refundAmount, refundedAt: new Date(timestamp).toISOString() };
}

function rejectRefund(): never {
  throw new ApplicationError(400, "BILLING_EVIDENCE_MISMATCH", "Alipay refund evidence is invalid.");
}
