// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated from workspace backend i18n assets.

export const PublicApiMessages = {
  "en-US": {
    "common.success": "success",
    "error.req.invalid_body": "Request content is invalid. Please review it and try again.",
    "error.req.invalid_email": "Please enter a valid email address.",
    "error.req.invalid_datetime": "Please enter a valid date-time value.",
    "error.req.invalid_enum": "The provided value is not in the allowed set.",
    "error.req.missing_required": "Missing required field: {field}.",
    "error.auth.invalid_credential": "Invalid account or password.",
    "error.auth.bearer_required": "Please sign in first.",
    "error.auth.invalid_token": "Your session is invalid. Please sign in again.",
    "error.auth.refresh_token_required": "A refresh token is required.",
    "error.auth.verification_code_required": "Please enter the verification code.",
    "error.auth.verification_code_invalid": "The verification code is invalid or expired.",
    "error.auth.app_scope_mismatch": "The current app scope does not match this request.",
    "error.auth.rate_limited": "Too many attempts. Please try again later.",
    "error.app.not_found": "The requested app does not exist.",
    "error.app.blocked": "This app is currently unavailable.",
    "error.system.internal": "An unexpected internal error occurred."
  },
  "zh-CN": {
    "common.success": "成功",
    "error.req.invalid_body": "请求内容不合法，请检查后重试。",
    "error.req.invalid_email": "请输入有效的邮箱地址。",
    "error.req.invalid_datetime": "请输入有效的时间格式。",
    "error.req.invalid_enum": "输入的值不在允许范围内。",
    "error.req.missing_required": "缺少必要字段：{field}。",
    "error.auth.invalid_credential": "账号或密码错误。",
    "error.auth.bearer_required": "请先登录。",
    "error.auth.invalid_token": "当前登录态无效，请重新登录。",
    "error.auth.refresh_token_required": "缺少刷新令牌。",
    "error.auth.verification_code_required": "请输入验证码。",
    "error.auth.verification_code_invalid": "验证码无效或已过期。",
    "error.auth.app_scope_mismatch": "当前应用范围与请求不匹配。",
    "error.auth.rate_limited": "尝试次数过多，请稍后再试。",
    "error.app.not_found": "请求的应用不存在。",
    "error.app.blocked": "当前应用暂不可用。",
    "error.system.internal": "系统出现异常，请稍后重试。"
  }
} as const;

export type PublicApiMessageLocale = keyof typeof PublicApiMessages;