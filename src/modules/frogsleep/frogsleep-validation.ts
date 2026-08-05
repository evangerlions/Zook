import { badRequest } from "../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../shared/types.ts";

export interface PaginationParams {
  limit: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    limit: number;
    next_cursor: string | null;
    has_more: boolean;
  };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export function parseIsoTimestamp(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    badRequest("REQ_INVALID_BODY", `${fieldName} must be an ISO timestamp.`);
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    badRequest("REQ_INVALID_BODY", `${fieldName} must be an ISO timestamp.`);
  }
  return timestamp.toISOString();
}

export function optionalIsoTimestamp(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return parseIsoTimestamp(value, fieldName);
}

export function parseWeekStart(value: unknown, fieldName = "week_start"): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    badRequest("REQ_INVALID_BODY", `${fieldName} must be an ISO date.`);
  }
  const trimmed = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00.000Z`
    : trimmed;
  const parsed = new Date(dateOnly);
  if (Number.isNaN(parsed.getTime())) {
    badRequest("REQ_INVALID_BODY", `${fieldName} must be an ISO date.`);
  }
  return parsed.toISOString().slice(0, 10);
}

export function currentUtcWeekStart(now = new Date()): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - day + 1);
  return start.toISOString().slice(0, 10);
}

export function parseDateWindow(input: {
  from?: unknown;
  to?: unknown;
}, names: { from: string; to: string } = { from: "from", to: "to" }) {
  const from = optionalIsoTimestamp(input.from, names.from);
  const to = optionalIsoTimestamp(input.to, names.to);
  if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
    badRequest("REQ_INVALID_BODY", `${names.from} must be before ${names.to}.`);
  }
  return { from, to };
}

export function parseFiniteNumber(value: unknown, fieldName: string, options: {
  min?: number;
  max?: number;
  defaultValue?: number;
} = {}): number {
  const input = value === undefined || value === null || value === ""
    ? options.defaultValue
    : value;
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    badRequest("REQ_INVALID_BODY", `${fieldName} must be a finite number.`);
  }
  if (options.min !== undefined && parsed < options.min) {
    badRequest("REQ_INVALID_BODY", `${fieldName} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && parsed > options.max) {
    badRequest("REQ_INVALID_BODY", `${fieldName} must be at most ${options.max}.`);
  }
  return parsed;
}

export function parsePaginationParams(input: Record<string, unknown> | undefined): PaginationParams {
  const rawLimit = input?.limit;
  const limit = rawLimit === undefined || rawLimit === null || rawLimit === ""
    ? DEFAULT_LIMIT
    : parseFiniteNumber(rawLimit, "limit", { min: 1, max: MAX_LIMIT });
  const cursor = typeof input?.cursor === "string" && input.cursor.trim()
    ? input.cursor.trim()
    : undefined;
  return { limit: Math.floor(limit), cursor };
}

export function paginateRecords<T extends FrogSleepEntityRecord>(
  records: T[],
  params: PaginationParams,
): PaginatedResult<T> {
  const cursor = decodeCursor(params.cursor);
  const sorted = [...records].sort((left, right) => compareRecordTimeDesc(left, right));
  const filtered = cursor
    ? sorted.filter((item) => isRecordAfterCursor(item, cursor))
    : sorted;
  const page = filtered.slice(0, params.limit + 1);
  const items = page.slice(0, params.limit);
  const hasMore = page.length > params.limit;
  return {
    items,
    pagination: {
      limit: params.limit,
      next_cursor: hasMore && items.length > 0 ? encodeCursor(items[items.length - 1] as T) : null,
      has_more: hasMore,
    },
  };
}

function compareRecordTimeDesc(left: FrogSleepEntityRecord, right: FrogSleepEntityRecord): number {
  const rightTime = recordSortTime(right);
  const leftTime = recordSortTime(left);
  const timeCompare = rightTime.localeCompare(leftTime);
  return timeCompare === 0 ? right.id.localeCompare(left.id) : timeCompare;
}

function recordSortTime(record: FrogSleepEntityRecord): string {
  return record.occurredAt ?? record.startsAt ?? record.createdAt;
}

function encodeCursor(record: FrogSleepEntityRecord): string {
  return Buffer.from(JSON.stringify({
    t: recordSortTime(record),
    id: record.id,
  }), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): { t: string; id: string } | undefined {
  if (!cursor) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { t?: unknown; id?: unknown };
    if (typeof parsed.t === "string" && typeof parsed.id === "string") {
      return { t: parsed.t, id: parsed.id };
    }
  } catch {
    badRequest("REQ_INVALID_BODY", "cursor is invalid.");
  }
  badRequest("REQ_INVALID_BODY", "cursor is invalid.");
}

function isRecordAfterCursor(record: FrogSleepEntityRecord, cursor: { t: string; id: string }): boolean {
  const time = recordSortTime(record);
  if (time < cursor.t) {
    return true;
  }
  return time === cursor.t && record.id < cursor.id;
}
