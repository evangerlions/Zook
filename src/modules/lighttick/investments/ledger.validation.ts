import {
  keys,
  object,
  text,
  fail,
} from "../learning/native-learning.validation.ts";
import { investmentId } from "./investment.service.ts";
import { decimalInput } from "./decimal.ts";
import type { LedgerInput } from "./ledger.types.ts";
export function ledgerInput(
  b: Record<string, unknown>,
  today: string,
): LedgerInput {
  keys(b, ["base_revision", "business_date", "kind", "fill", "cash"]);
  const date = text(b.business_date, 10, true);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    date < "0001-01-01" ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date ||
    date > today
  )
    fail(
      422,
      "Ledger date must be a real date through today in Asia/Shanghai.",
    );
  if (b.kind === "fill") {
    if (b.cash !== undefined)
      fail(422, "One event must have one declared kind.");
    const f = object(b.fill);
    keys(f, [
      "instrument_id",
      "side",
      "price",
      "quantity",
      "fee",
      "tax",
      "source",
      "settlement_amount",
    ]);
    if (
      !["buy", "sell"].includes(String(f.side)) ||
      !["manual", "csv", "broker", "fund_confirmation"].includes(
        String(f.source),
      ) ||
      f.fee === undefined ||
      f.tax === undefined ||
      f.settlement_amount === undefined
    )
      fail(
        422,
        "Fill direction, source, fees and settlement completeness must be explicit.",
      );
    if (f.source !== "fund_confirmation" && f.settlement_amount !== null)
      fail(422, "Actual settlement only applies to fund confirmations.");
    return {
      business_date: date,
      kind: "fill",
      fill: {
        instrument_id: investmentId(f.instrument_id),
        side: f.side as "buy" | "sell",
        source: f.source as any,
        price: decimalInput(f.price, true),
        quantity: decimalInput(f.quantity, true),
        fee: f.fee === null ? null : decimalInput(f.fee),
        tax: f.tax === null ? null : decimalInput(f.tax),
        settlement_amount:
          f.settlement_amount === null
            ? null
            : decimalInput(f.settlement_amount),
      },
    };
  }
  if (b.kind === "cash") {
    if (b.fill !== undefined)
      fail(422, "One event must have one declared kind.");
    const c = object(b.cash);
    keys(c, ["kind", "amount"]);
    if (
      ![
        "deposit",
        "withdrawal",
        "dividend",
        "interest",
        "fee",
        "fund_receivable_hold",
        "fund_receivable_release",
      ].includes(String(c.kind))
    )
      fail(422, "Unsupported cash event kind.");
    return {
      business_date: date,
      kind: "cash",
      cash: { kind: c.kind as any, amount: decimalInput(c.amount, true) },
    };
  }
  fail(422, "Declare a fill or cash event.");
}
