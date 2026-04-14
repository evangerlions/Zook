import { PublicApiMessages } from "../generated/i18n/public-api-messages.generated.ts";
import { RequestLocaleService } from "./request-locale.service.ts";
import type { HttpRequest } from "../shared/types.ts";

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
    key: string,
    request?: HttpRequest,
    params: Record<string, string | number> = {},
    fallback = "Request content is invalid. Please review it and try again.",
  ): string {
    const locale = this.resolveLocale(request);
    const template =
      PublicApiMessages[locale][key as keyof typeof PublicApiMessages["en-US"]] ??
      PublicApiMessages["en-US"][key as keyof typeof PublicApiMessages["en-US"]];
    const base = typeof template === "string" ? template : fallback;
    return base.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
  }

  fromErrorCode(
    code: string,
    request?: HttpRequest,
    fallback?: string,
  ): string | undefined {
    const map: Record<string, string> = {
      AUTH_INVALID_CREDENTIAL: "error.auth.invalid_credential",
      AUTH_BEARER_REQUIRED: "error.auth.bearer_required",
      AUTH_INVALID_TOKEN: "error.auth.invalid_token",
      AUTH_REFRESH_TOKEN_REQUIRED: "error.auth.refresh_token_required",
      AUTH_VERIFICATION_CODE_REQUIRED: "error.auth.verification_code_required",
      AUTH_VERIFICATION_CODE_INVALID: "error.auth.verification_code_invalid",
      AUTH_APP_SCOPE_MISMATCH: "error.auth.app_scope_mismatch",
      AUTH_RATE_LIMITED: "error.auth.rate_limited",
      APP_NOT_FOUND: "error.app.not_found",
      APP_BLOCKED: "error.app.blocked",
      SYS_INTERNAL_ERROR: "error.system.internal",
    };
    const key = map[code];
    if (!key) {
      return fallback;
    }
    return this.format(key, request, {}, fallback);
  }
}
