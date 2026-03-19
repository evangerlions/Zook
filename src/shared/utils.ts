import { createHash, createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";

const DEFAULT_TIMEZONE = "Asia/Shanghai";

/**
 * randomId provides stable prefixed identifiers for in-memory records and request IDs.
 */
export function randomId(prefix = "id"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

/**
 * createOpaqueToken issues refresh-token-like opaque values.
 */
export function createOpaqueToken(prefix = "rt"): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function randomNumericCode(length = 6): string {
  const max = 10 ** length;
  return randomInt(0, max).toString().padStart(length, "0");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function signValue(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

/**
 * getHeader reads HTTP headers case-insensitively to simplify local transport adapters.
 */
export function getHeader(
  headers: Record<string, string | undefined>,
  headerName: string,
): string | undefined {
  const target = headerName.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
}

export function parseCookies(headerValue?: string): Record<string, string> {
  if (!headerValue) {
    return {};
  }

  return headerValue
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((cookies, pair) => {
      const [key, ...rest] = pair.split("=");
      cookies[key] = decodeURIComponent(rest.join("="));
      return cookies;
    }, {});
}

/**
 * toDateKey converts timestamps to natural-day keys in the configured reporting timezone.
 */
export function toDateKey(input: string | Date, timeZone = DEFAULT_TIMEZONE): string {
  const date = input instanceof Date ? input : new Date(input);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function toHourKey(input: string | Date, timeZone = DEFAULT_TIMEZONE): string {
  const date = input instanceof Date ? input : new Date(input);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}-${values.hour}`;
}

/**
 * enumerateDateKeys builds an inclusive date range for metric rollups.
 */
export function enumerateDateKeys(dateFrom: string, dateTo: string): string[] {
  const items: string[] = [];
  const current = new Date(`${dateFrom}T00:00:00+08:00`);
  const end = new Date(`${dateTo}T00:00:00+08:00`);

  while (current <= end) {
    items.push(toDateKey(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return items;
}

export function assertDateKey(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date key: ${value}`);
  }
}
