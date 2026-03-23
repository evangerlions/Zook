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
/**
 * ===== 敏感数据脱敏工具 =====
 * 用于对敏感字段（如密钥、密码等）进行脱敏处理，返回给前端显示。
 */

/**
 * 敏感字段配置类型
 */
export interface SensitiveFieldConfig {
  /** 字段名 */
  field: string;
  /** 可见字符数（前N位显示明文），默认4 */
  visibleChars?: number;
  /** 最小脱敏长度，默认4个星号 */
  minMaskChars?: number;
}

/**
 * 默认敏感字段配置列表
 * 后续新增敏感字段时，只需在此添加配置即可
 */
export const SENSITIVE_FIELD_CONFIGS: SensitiveFieldConfig[] = [
  { field: "secretId", visibleChars: 4, minMaskChars: 8 },
  { field: "secretKey", visibleChars: 4, minMaskChars: 8 },
  { field: "password", visibleChars: 0, minMaskChars: 8 },
  { field: "apiKey", visibleChars: 4, minMaskChars: 8 },
  { field: "accessToken", visibleChars: 8, minMaskChars: 8 },
  { field: "refreshToken", visibleChars: 8, minMaskChars: 8 },
];

/**
 * 对单个敏感值进行脱敏
 * @param value 原始值
 * @param visibleChars 可见字符数（前N位显示明文），默认4
 * @param minMaskChars 最小脱敏星号数，默认4
 * @returns 脱敏后的字符串
 */
export function maskSensitiveValue(
  value: string,
  visibleChars: number = 4,
  minMaskChars: number = 4,
): string {
  if (!value || typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const actualVisible = Math.min(visibleChars, trimmed.length);
  const maskedLength = Math.max(minMaskChars, trimmed.length - actualVisible);

  return trimmed.slice(0, actualVisible) + "*".repeat(maskedLength);
}

/**
 * 检查值是否为脱敏后的值（用于更新时判断是否需要保留原值）
 * @param value 待检查的值
 * @param originalVisibleChars 原始脱敏时使用的可见字符数
 * @returns 是否为脱敏值
 */
export function isMaskedValue(value: string, originalVisibleChars: number = 4): boolean {
  if (!value || typeof value !== "string") {
    return false;
  }

  // 脱敏值的特点：前面是明文，后面全是星号
  const starIndex = value.indexOf("*");
  if (starIndex === -1) {
    return false;
  }

  // 检查星号后面是否全是星号
  const afterStars = value.slice(starIndex);
  return afterStars === "*".repeat(afterStars.length);
}

/**
 * 解析敏感输入值：如果传入的是脱敏值，则返回原值；否则返回新值
 * @param input 用户输入的值
 * @param existingValue 现有的原始值
 * @param visibleChars 脱敏时使用的可见字符数
 * @returns 最终值
 */
export function resolveSensitiveInput(
  input: unknown,
  existingValue?: string,
  visibleChars: number = 4,
): string {
  const normalized = typeof input === "string" ? input.trim() : "";
  const existing = existingValue?.trim() ?? "";

  if (!normalized) {
    return "";
  }

  if (!existing) {
    return normalized;
  }

  if (isMaskedValue(normalized)) {
    const starIndex = normalized.indexOf("*");
    const prefix = normalized.slice(0, starIndex);
    if (existing.startsWith(prefix)) {
      return existing;
    }
  }

  return normalized;
}

/**
 * 对对象中的敏感字段进行脱敏
 * @param obj 原始对象
 * @param configs 敏感字段配置列表，默认使用 SENSITIVE_FIELD_CONFIGS
 * @returns 脱敏后的对象副本
 */
export function maskSensitiveFields<T extends Record<string, unknown>>(
  obj: T,
  configs: SensitiveFieldConfig[] = SENSITIVE_FIELD_CONFIGS,
): T {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  const result = { ...obj } as T;
  const configMap = new Map(configs.map((c) => [c.field, c]));

  for (const [key, value] of Object.entries(result)) {
    const config = configMap.get(key);
    if (!config) {
      continue;
    }

    if (typeof value === "string") {
      (result as Record<string, unknown>)[key] = maskSensitiveValue(
        value,
        config.visibleChars ?? 4,
        config.minMaskChars ?? 4,
      );
    }
  }

  return result;
}

/**
 * 解析对象中的敏感字段：如果字段值是脱敏形式，则保留原值
 * @param input 用户输入的对象
 * @param existing 现有的原始对象
 * @param configs 敏感字段配置列表
 * @returns 处理后的对象
 */
export function resolveSensitiveFields<T extends Record<string, unknown>>(
  input: T,
  existing: Partial<T> | undefined,
  configs: SensitiveFieldConfig[] = SENSITIVE_FIELD_CONFIGS,
): T {
  if (!input || typeof input !== "object") {
    return input;
  }

  const result = { ...input } as T;
  const configMap = new Map(configs.map((c) => [c.field, c]));

  for (const [key, config] of configMap) {
    const inputValue = result[key];
    const existingValue = existing?.[key];

    if (typeof inputValue === "string" && typeof existingValue === "string") {
      (result as Record<string, unknown>)[key] = resolveSensitiveInput(
        inputValue,
        existingValue,
        config.visibleChars ?? 4,
      );
    }
  }

  return result;
}