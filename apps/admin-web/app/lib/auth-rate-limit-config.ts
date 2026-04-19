import type { AdminAuthRateLimitDocument, AuthRateLimitConfig } from "./types";

export function createDefaultAuthRateLimitConfig(): AuthRateLimitConfig {
  return {
    resendCooldownSeconds: 60,
    verificationCodeTtlSeconds: 600,
    sendCodeWindowSeconds: 600,
    sendCodeWindowLimit: 3,
    verifyWindowSeconds: 600,
    verifyWindowLimit: 10,
    accountDailyLimit: 10,
    ipHourlyLimit: 20,
    maxFailedCodeAttempts: 10,
  };
}

export function cloneAuthRateLimitConfig(
  config: AuthRateLimitConfig = createDefaultAuthRateLimitConfig(),
): AuthRateLimitConfig {
  return {
    resendCooldownSeconds: Number(config.resendCooldownSeconds),
    verificationCodeTtlSeconds: Number(config.verificationCodeTtlSeconds),
    sendCodeWindowSeconds: Number(config.sendCodeWindowSeconds),
    sendCodeWindowLimit: Number(config.sendCodeWindowLimit),
    verifyWindowSeconds: Number(config.verifyWindowSeconds),
    verifyWindowLimit: Number(config.verifyWindowLimit),
    accountDailyLimit: Number(config.accountDailyLimit),
    ipHourlyLimit: Number(config.ipHourlyLimit),
    maxFailedCodeAttempts: Number(config.maxFailedCodeAttempts),
  };
}

export function normalizeAuthRateLimitDocument(document: AdminAuthRateLimitDocument | null) {
  return document;
}

export function formatAuthRateLimitConfigJson(
  config: AuthRateLimitConfig = createDefaultAuthRateLimitConfig(),
) {
  return JSON.stringify(serializeAuthRateLimitConfig(cloneAuthRateLimitConfig(config)), null, 2);
}

export function parseAuthRateLimitConfigText(rawText: string) {
  const parsed = parseJsonObject(rawText);
  const config = normalizeAuthRateLimitConfigInput(parsed);

  return {
    config,
    normalizedText: JSON.stringify(config, null, 2),
  };
}

export function getAuthRateLimitValidationError(config: AuthRateLimitConfig) {
  try {
    serializeAuthRateLimitConfig(config);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "认证风控配置校验失败。";
  }
}

export function serializeAuthRateLimitConfig(config: AuthRateLimitConfig): AuthRateLimitConfig {
  return normalizeAuthRateLimitConfigInput(config);
}

function normalizeAuthRateLimitConfigInput(input: unknown): AuthRateLimitConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("认证风控配置必须是 JSON object。");
  }

  const source = input as Record<string, unknown>;
  const normalized: AuthRateLimitConfig = {
    resendCooldownSeconds: requirePositiveInteger(source.resendCooldownSeconds, "发码冷却秒数"),
    verificationCodeTtlSeconds: requirePositiveInteger(source.verificationCodeTtlSeconds, "验证码有效期秒数"),
    sendCodeWindowSeconds: requirePositiveInteger(source.sendCodeWindowSeconds, "发码窗口秒数"),
    sendCodeWindowLimit: requirePositiveInteger(source.sendCodeWindowLimit, "发码窗口次数上限"),
    verifyWindowSeconds: requirePositiveInteger(source.verifyWindowSeconds, "验证提交窗口秒数"),
    verifyWindowLimit: requirePositiveInteger(source.verifyWindowLimit, "验证提交窗口次数上限"),
    accountDailyLimit: requirePositiveInteger(source.accountDailyLimit, "账号自然日配额"),
    ipHourlyLimit: requirePositiveInteger(source.ipHourlyLimit, "IP 自然小时配额"),
    maxFailedCodeAttempts: requirePositiveInteger(source.maxFailedCodeAttempts, "验证码最多输错次数"),
  };

  if (normalized.verifyWindowLimit < normalized.maxFailedCodeAttempts) {
    throw new Error("验证提交窗口次数上限不能小于验证码最多输错次数，否则错码阈值永远不会真正生效。");
  }

  return normalized;
}

function parseJsonObject(rawText: string): unknown {
  if (!rawText.trim()) {
    throw new Error("请先填写认证风控配置 JSON。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "JSON 解析失败。");
  }

  return parsed;
}

function requirePositiveInteger(value: unknown, label: string) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${label}必须是正整数。`);
  }
  return numeric;
}
