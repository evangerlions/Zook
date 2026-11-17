import { ApplicationError } from "../../shared/errors.ts";
import { strictObject } from "../../shared/strict-object.ts";

export interface ExpenseInput {
  title: string; amount: number; category: string; subcategory: string;
  note?: string; source?: string; occurredAt?: number;
}
export function expenseInput(value: unknown): ExpenseInput {
  const body = strictObject(value, ["title", "amount", "category", "subcategory", "note", "source", "occurredAt"]);
  for (const key of ["title", "category", "subcategory"]) {
    if (typeof body[key] !== "string" || !(body[key] as string).trim() || (body[key] as string).length > 200) invalid();
  }
  if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount < 0 || body.amount > 1e9 || Math.abs(body.amount * 100 - Math.round(body.amount * 100)) > 1e-5) invalid();
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 2000)) invalid();
  if (body.source !== undefined && (typeof body.source !== "string" || body.source.length > 200)) invalid();
  if (body.occurredAt !== undefined && (typeof body.occurredAt !== "number" || !Number.isSafeInteger(body.occurredAt) || body.occurredAt <= 0 || body.occurredAt > 8_640_000_000_000_000)) invalid();
  return { title: (body.title as string).trim(), amount: body.amount as number, category: body.category as string,
    subcategory: body.subcategory as string, note: body.note as string | undefined,
    source: (body.source as string | undefined) ?? "支出-从公共账户", occurredAt: body.occurredAt as number | undefined };
}
function invalid(): never { throw new ApplicationError(400, "REQ_INVALID_BODY", "Invalid expense fields; amount must be non-negative with at most two decimals."); }
