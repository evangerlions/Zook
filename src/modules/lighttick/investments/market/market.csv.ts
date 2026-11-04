import type { DailyRequest, DailyBar } from "./market.types.ts";
import { marketError, normalizeBar } from "./market.validation.ts";
export function csvRows(text: string): string[][] {
  if (typeof text !== "string" || Buffer.byteLength(text) > 256000)
    marketError("CSV_TOO_LARGE", 422);
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    endedQuote = false;
  text = text.replace(/^\ufeff/, "");
  const field = () => {
    if (cell.length > 4096) marketError("CSV_CELL_TOO_LARGE", 422);
    row.push(cell);
    if (row.length > 32) marketError("CSV_TOO_MANY_COLUMNS", 422);
    cell = "";
    endedQuote = false;
  };
  const record = () => {
    field();
    if (row.some((v) => v !== "")) rows.push(row);
    if (rows.length > 1001) marketError("CSV_TOO_MANY_ROWS", 422);
    row = [];
  };
  for (let i = 0; i < text.length; ++i) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          ++i;
        } else {
          quoted = false;
          endedQuote = true;
        }
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      if (cell || endedQuote) marketError("CSV_INVALID_QUOTES", 422);
      quoted = true;
    } else if (ch === ",") field();
    else if (ch === "\n") record();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") ++i;
      record();
    } else {
      if (endedQuote) marketError("CSV_INVALID_QUOTES", 422);
      cell += ch;
    }
  }
  if (quoted) marketError("CSV_INVALID_QUOTES", 422);
  if (cell || row.length || endedQuote) record();
  if (rows.length < 2) marketError("CSV_EMPTY", 422);
  return rows;
}
export function csvDaily(
  r: DailyRequest,
  now: Date,
): { bars: DailyBar[]; units: { volume: string; amount: string } } {
  if (
    !r.declared_source?.trim() ||
    r.declared_source.length > 200 ||
    !["shares", "lots100"].includes(r.volume_unit ?? "") ||
    !["CNY", "thousand_CNY", "ten_thousand_CNY"].includes(r.amount_unit ?? "")
  )
    marketError("CSV_SOURCE_UNITS_REQUIRED", 422);
  const rows = csvRows(r.csv!),
    aliases: Record<string, string> = {
      日期: "date",
      开盘: "open",
      最高: "high",
      最低: "low",
      收盘: "close",
      成交量: "volume",
      成交额: "amount",
      换手率: "turnover_rate_pct",
    };
  const names = rows
    .shift()!
    .map((c) =>
      Object.hasOwn(aliases, c.trim()) ? aliases[c.trim()] : c.trim(),
    );
  if (
    new Set(names).size !== names.length ||
    !["date", "open", "high", "low", "close", "volume", "amount"].every((n) =>
      names.includes(n),
    )
  )
    marketError("CSV_INVALID_HEADERS", 422);
  const volume = r.volume_unit === "lots100" ? "100" : "1",
    amount = { CNY: "1", thousand_CNY: "1000", ten_thousand_CNY: "10000" }[
      r.amount_unit!
    ];
  const bars = rows.map((cells) => {
    if (cells.length !== names.length) marketError("CSV_INVALID_ROW", 422);
    return normalizeBar(
      Object.fromEntries(names.map((n, i) => [n, cells[i].trim()])),
      r,
      now,
      volume,
      amount,
    );
  });
  return { bars, units: { volume: r.volume_unit!, amount: r.amount_unit! } };
}
