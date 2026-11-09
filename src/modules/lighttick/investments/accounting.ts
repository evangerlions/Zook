import type { Decimal } from "decimal.js";
import {
  LedgerDecimal as D,
  decimalInput,
  decimalString as string,
} from "./decimal.ts";
import { ApplicationError } from "../../../shared/errors.ts";
export interface OpeningPosition {
  instrument_id: string;
  quantity: string;
  cost: string | null;
}
export interface CashEvent {
  kind:
    | "deposit"
    | "withdrawal"
    | "dividend"
    | "interest"
    | "fee"
    | "fund_receivable_hold"
    | "fund_receivable_release";
  amount: string;
}
export interface Fill {
  instrument_id: string;
  side: "buy" | "sell";
  price: string;
  quantity: string;
  fee: string | null;
  tax: string | null;
  source?: "manual" | "csv" | "broker" | "fund_confirmation";
  settlement_amount?: string | null;
}
interface Position {
  quantity: Decimal;
  cost: Decimal | null;
  realized: Decimal | null;
  fees_complete: boolean;
  settlements_complete: boolean;
}
export const ACCOUNTING_VERSION = "moving-average-decimal60-half-even-v1";
export function reconcile(
  openingCash: string,
  cashEvents: CashEvent[],
  fills: Fill[],
  openingPositions: OpeningPosition[] = [],
  marks: Record<string, string> = {},
) {
  if (
    cashEvents.length > 10000 ||
    fills.length > 10000 ||
    openingPositions.length > 100
  )
    throw new ApplicationError(
      413,
      "VALIDATION_ERROR",
      "Ledger exceeds the bounded calculation capacity.",
    );
  let cash = new D(decimalInput(openingCash)),
    feesComplete = true,
    settlementsComplete = true,
    receivables = new D(0);
  const positions = new Map<string, Position>();
  const position = (id: string) => {
    if (!id || id.length > 100)
      throw new ApplicationError(
        422,
        "VALIDATION_ERROR",
        "Invalid instrument identity.",
      );
    if (!positions.has(id))
      positions.set(id, {
        quantity: new D(0),
        cost: new D(0),
        realized: new D(0),
        fees_complete: true,
        settlements_complete: true,
      });
    return positions.get(id)!;
  };
  for (const opening of openingPositions) {
    const item = position(opening.instrument_id);
    item.quantity = item.quantity.plus(decimalInput(opening.quantity, true));
    item.cost =
      opening.cost === null || item.cost === null
        ? null
        : item.cost.plus(decimalInput(opening.cost));
  }
  for (const event of cashEvents) {
    const amount = new D(decimalInput(event.amount, true));
    if (
      ![
        "deposit",
        "withdrawal",
        "dividend",
        "interest",
        "fee",
        "fund_receivable_hold",
        "fund_receivable_release",
      ].includes(event.kind)
    )
      throw new ApplicationError(
        422,
        "VALIDATION_ERROR",
        "Unsupported cash event.",
      );
    cash = ["withdrawal", "fee", "fund_receivable_hold"].includes(event.kind)
      ? cash.minus(amount)
      : cash.plus(amount);
    if (event.kind === "fund_receivable_hold")
      receivables = receivables.plus(amount);
    else if (event.kind === "fund_receivable_release")
      receivables = receivables.minus(amount);
  }
  for (const fill of fills) {
    const item = position(fill.instrument_id),
      quantity = new D(decimalInput(fill.quantity, true)),
      price = new D(decimalInput(fill.price, true)),
      known = fill.fee !== null && fill.tax !== null;
    if (fill.fee === undefined || fill.tax === undefined)
      throw new ApplicationError(
        422,
        "VALIDATION_ERROR",
        "Unknown fees must be explicit null.",
      );
    feesComplete = feesComplete && known;
    item.fees_complete = item.fees_complete && known;
    const costs = new D(fill.fee === null ? "0" : decimalInput(fill.fee)).plus(
        fill.tax === null ? "0" : decimalInput(fill.tax),
      ),
      value = quantity.mul(price),
      settlement =
        fill.settlement_amount == null
          ? null
          : new D(decimalInput(fill.settlement_amount));
    if (fill.source === "fund_confirmation" && settlement === null) {
      settlementsComplete = false;
      item.settlements_complete = false;
    }
    if (fill.side === "buy") {
      const paid = settlement ?? value.plus(costs);
      cash = cash.minus(paid);
      if (item.quantity.isZero()) item.cost = new D(0);
      if (item.cost !== null) item.cost = item.cost.plus(paid);
      item.quantity = item.quantity.plus(quantity);
    } else if (fill.side === "sell") {
      if (quantity.gt(item.quantity))
        throw new ApplicationError(
          422,
          "VALIDATION_ERROR",
          "Sale exceeds confirmed position; restore opening or fill facts first.",
        );
      const allocated =
          item.cost === null
            ? null
            : item.cost.mul(quantity).div(item.quantity),
        proceeds = settlement ?? value.minus(costs);
      cash = cash.plus(proceeds);
      item.realized =
        allocated === null || item.realized === null
          ? null
          : item.realized.plus(proceeds).minus(allocated);
      item.quantity = item.quantity.minus(quantity);
      if (item.cost !== null) item.cost = item.cost.minus(allocated!);
      if (item.quantity.isZero()) item.cost = new D(0);
    } else
      throw new ApplicationError(
        422,
        "VALIDATION_ERROR",
        "Unsupported fill side.",
      );
  }
  let realized: Decimal | null = new D(0),
    equity: Decimal | null = cash.plus(receivables);
  const output = [...positions].map(([instrument_id, item]) => {
    realized =
      realized === null || item.realized === null
        ? null
        : realized.plus(item.realized);
    const mark = Object.hasOwn(marks, instrument_id)
      ? marks[instrument_id]
      : null;
    if (mark !== null) decimalInput(mark, true);
    const value = item.quantity.isZero()
      ? new D(0)
      : mark === null
        ? null
        : new D(mark).mul(item.quantity);
    equity = equity === null || value === null ? null : equity.plus(value);
    const unrealized =
      value === null || item.cost === null ? null : value.minus(item.cost);
    return {
      instrument_id,
      quantity: string(item.quantity),
      cost: string(item.cost),
      realized: string(item.realized),
      fees_complete: item.fees_complete,
      settlements_complete: item.settlements_complete,
      market_value: string(value),
      unrealized:
        item.fees_complete && item.settlements_complete
          ? string(unrealized)
          : null,
      mark,
    };
  });
  return {
    cash: string(cash),
    cash_verified: feesComplete && settlementsComplete,
    receivables: string(receivables),
    positions: output,
    realized: string(realized),
    fees_complete: feesComplete,
    net_realized: feesComplete && settlementsComplete ? string(realized) : null,
    equity: feesComplete && settlementsComplete ? string(equity) : null,
    settlements_complete: settlementsComplete,
    warnings: [
      ...(feesComplete
        ? []
        : ["费用未齐，现金和成本为暂估，不能作为精确净收益。"]),
      ...(settlementsComplete
        ? []
        : [
            "基金确认未填实际收支净额，现金按净值乘份额暂估；不能当作已核验净结果。",
          ]),
    ],
  };
}
