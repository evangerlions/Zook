import { PublicApiMessages } from "../generated/i18n/public-api-messages.generated.ts";
import { RequestLocaleService } from "./request-locale.service.ts";
import type { ErrorCode, HttpRequest } from "../shared/types.ts";

type PublicApiMessageKey = keyof (typeof PublicApiMessages)["en-US"];

const PUBLIC_ERROR_MESSAGE_KEYS = {
  AI_DECRYPT_FAILED: "error.ai.decrypt_failed",
  AI_EMBEDDING_INPUT_INVALID: "error.ai.embedding_input_invalid",
  AI_ENCRYPT_FAILED: "error.ai.encrypt_failed",
  AI_INPUT_CONTENT_SENSITIVE: "error.ai.input_content_sensitive",
  AI_RESPONSE_FORMAT_INVALID: "error.ai.response_format_invalid",
  AI_SCENE_NOT_SUPPORTED: "error.ai.scene_not_supported",
  AI_UNKNOWN_KEY_ID: "error.ai.unknown_key",
  AI_UNSUPPORTED_ALGORITHM: "error.ai.unsupported_algorithm",
  AI_UPSTREAM_AUTH_FAILED: "error.ai.upstream_bad_gateway",
  AI_UPSTREAM_BAD_GATEWAY: "error.ai.upstream_bad_gateway",
  AI_UPSTREAM_CONFIG_INVALID: "error.ai.upstream_bad_gateway",
  AI_UPSTREAM_INVALID_REQUEST: "error.ai.upstream_bad_gateway",
  AI_UPSTREAM_QUOTA_EXHAUSTED: "error.ai.upstream_bad_gateway",
  AI_UPSTREAM_RATE_LIMITED: "error.ai.upstream_bad_gateway",
  AI_UPSTREAM_RESPONSE_INVALID: "error.ai.upstream_bad_gateway",
  AI_UPSTREAM_TIMEOUT: "error.ai.upstream_timeout",
  APP_BLOCKED: "error.app.blocked",
  APP_JOIN_INVITE_REQUIRED: "error.app.join_invite_required",
  APP_MEMBER_BLOCKED: "error.app.member_blocked",
  APP_MEMBER_DELETED: "error.app.member_deleted",
  APP_NOT_FOUND: "error.app.not_found",
  AUTH_ACCOUNT_DELETE_CONFIRMATION_INVALID:
    "error.auth.account_delete_confirmation_invalid",
  AUTH_ACCOUNT_ALREADY_EXISTS: "error.auth.account_already_exists",
  AUTH_ACCOUNT_NOT_FOUND: "error.auth.account_not_found",
  AUTH_APP_SCOPE_MISMATCH: "error.auth.app_scope_mismatch",
  AUTH_BEARER_REQUIRED: "error.auth.bearer_required",
  AUTH_INVALID_CREDENTIAL: "error.auth.invalid_credential",
  AUTH_INVALID_TOKEN: "error.auth.invalid_token",
  AUTH_LOGIN_FORBIDDEN: "error.auth.login_forbidden",
  AUTH_LOGIN_TEMPORARILY_LOCKED: "error.auth.login_temporarily_locked",
  AUTH_PASSWORD_ALREADY_SET: "error.auth.password_already_set",
  AUTH_PASSWORD_NOT_SET: "error.auth.password_not_set",
  AUTH_QR_LOGIN_ALREADY_USED: "error.auth.qr_login_already_used",
  AUTH_QR_LOGIN_EXPIRED: "error.auth.qr_login_expired",
  AUTH_QR_LOGIN_INVALID: "error.auth.qr_login_invalid",
  AUTH_QR_LOGIN_TOKEN_REQUIRED: "error.auth.qr_login_token_required",
  AUTH_ONE_CLICK_TOKEN_INVALID: "error.auth.one_click_token_invalid",
  AUTH_RATE_LIMITED: "error.auth.rate_limited",
  AUTH_REFRESH_TOKEN_REQUIRED: "error.auth.refresh_token_required",
  AUTH_REFRESH_TOKEN_REVOKED: "error.auth.refresh_token_revoked",
  AUTH_USER_BLOCKED: "error.auth.user_blocked",
  AUTH_VERIFICATION_CODE_INVALID: "error.auth.verification_code_invalid",
  AUTH_VERIFICATION_CODE_REQUIRED: "error.auth.verification_code_required",
  CAPTCHA_PROVIDER_REQUEST_FAILED: "error.captcha.provider_failed",
  CAPTCHA_SERVICE_NOT_CONFIGURED: "error.captcha.service_not_configured",
  EMAIL_PROVIDER_REQUEST_FAILED: "error.email.provider_failed",
  EMAIL_SERVICE_NOT_CONFIGURED: "error.email.service_not_configured",
  FILE_ACCESS_DENIED: "error.file.access_denied",
  IAM_PERMISSION_DENIED: "error.iam.permission_denied",
  LLM_MODEL_NOT_FOUND: "error.ai.upstream_bad_gateway",
  LLM_PROVIDER_REQUEST_FAILED: "error.ai.upstream_bad_gateway",
  LLM_PROVIDER_RESPONSE_INVALID: "error.ai.upstream_bad_gateway",
  LLM_ROUTE_NOT_AVAILABLE: "error.ai.upstream_bad_gateway",
  LLM_SERVICE_NOT_CONFIGURED: "error.ai.upstream_bad_gateway",
  LOG_CLAIM_EXPIRED: "error.log.claim_expired",
  LOG_CLAIM_MISMATCH: "error.log.claim_mismatch",
  LOG_DECOMPRESS_FAILED: "error.log.decompress_failed",
  LOG_DECRYPT_FAILED: "error.log.decrypt_failed",
  LOG_INVALID_NDJSON: "error.log.invalid_ndjson",
  LOG_PAYLOAD_TOO_LARGE: "error.log.payload_too_large",
  LOG_TASK_ALREADY_COMPLETED: "error.log.task_already_completed",
  LOG_TASK_MISMATCH: "error.log.task_mismatch",
  LOG_UNSUPPORTED_ENCRYPTION: "error.log.unsupported_encryption",
  REQ_DATE_RANGE_INVALID: "error.req.invalid_date_range",
  REQ_INVALID_BODY: "error.req.invalid_body",
  REQ_INVALID_EVENT: "error.req.invalid_event",
  REQ_INVALID_HEADER: "error.req.invalid_header",
  REQ_INVALID_QUERY: "error.req.invalid_query",
  SMS_PROVIDER_REQUEST_FAILED: "error.sms.provider_failed",
  SMS_SERVICE_MISSING_SECRET_ID: "error.sms.service_not_configured",
  SMS_SERVICE_MISSING_SECRET_KEY: "error.sms.service_not_configured",
  SMS_SERVICE_MISSING_SDK_APP_ID: "error.sms.service_not_configured",
  SMS_SERVICE_MISSING_TEMPLATE_ID: "error.sms.service_not_configured",
  SMS_SERVICE_MISSING_SIGN_NAME: "error.sms.service_not_configured",
  SMS_SERVICE_NOT_CONFIGURED: "error.sms.service_not_configured",
  ONE_CLICK_PROVIDER_REQUEST_FAILED: "error.one_click.provider_failed",
  ONE_CLICK_SERVICE_NOT_CONFIGURED: "error.one_click.service_not_configured",
  SYS_INTERNAL_ERROR: "error.system.internal",
} satisfies Partial<Record<ErrorCode, PublicApiMessageKey>>;

export class PublicApiMessageService {
  constructor(
    private readonly requestLocaleService = new RequestLocaleService(),
  ) {}

  resolveLocale(request?: HttpRequest): keyof typeof PublicApiMessages {
    const resolved = this.requestLocaleService.resolve(
      request ?? {
        method: "GET",
        path: "/",
        headers: {},
      },
      {
        supportedLocales: ["en-US", "zh-CN"],
        appDefaultLocale: "en-US",
      },
    ).locale;
    return resolved.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  }

  format(
    key: PublicApiMessageKey,
    request?: HttpRequest,
    params: Record<string, string | number> = {},
    fallback = "Request content is invalid. Please review it and try again.",
  ): string {
    const locale = this.resolveLocale(request);
    const template =
      PublicApiMessages[locale][
        key as keyof (typeof PublicApiMessages)["en-US"]
      ] ??
      PublicApiMessages["en-US"][
        key as keyof (typeof PublicApiMessages)["en-US"]
      ];
    const base = typeof template === "string" ? template : fallback;
    return base.replace(/\{(\w+)\}/g, (_, name: string) =>
      String(params[name] ?? `{${name}}`),
    );
  }

  fromErrorCode(
    code: ErrorCode,
    request?: HttpRequest,
    fallback?: string,
  ): string | undefined {
    const key = PUBLIC_ERROR_MESSAGE_KEYS[code];
    if (!key) {
      return fallback;
    }
    return this.format(key, request, {}, fallback);
  }
}
