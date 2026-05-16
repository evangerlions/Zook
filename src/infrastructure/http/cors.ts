const CORS_ALLOWLIST: Array<string | RegExp> = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
  "https://app-dev.youwoai.net",
  "https://app.youwoai.net",
];

const CORS_ALLOWED_METHODS = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"];
const CORS_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-App-Id",
  "X-Platform",
  "X-App-Version",
  "X-Request-Id",
  "X-App-Locale",
  "X-App-Country-Code",
  "X-Did",
  "X-Log-Claim-Token",
  "X-Log-Key-Id",
  "X-Log-Enc",
  "X-Log-Nonce",
  "X-Log-Content",
  "X-Log-Task-Id",
  "X-Log-Line-Count",
  "X-Log-Plain-Bytes",
  "X-Log-Compressed-Bytes",
];
const CORS_EXPOSED_HEADERS = ["X-Request-Id"];
const CORS_MAX_AGE_SECONDS = 86400;

export interface CorsDecision {
  allowed: boolean;
  origin?: string;
}

export function resolveCorsDecision(origin?: string): CorsDecision {
  if (!origin) {
    return { allowed: true };
  }

  const allowed = CORS_ALLOWLIST.some((rule) => (
    typeof rule === "string" ? rule === origin : rule.test(origin)
  ));

  return allowed ? { allowed: true, origin } : { allowed: false, origin };
}

export function buildCorsHeaders(origin?: string): Record<string, string> {
  if (!origin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Expose-Headers": CORS_EXPOSED_HEADERS.join(", "),
    Vary: "Origin",
  };
}

export function buildCorsPreflightHeaders(
  origin?: string,
  requestedHeaders?: string,
): Record<string, string> {
  if (!origin) {
    return {};
  }

  return {
    ...buildCorsHeaders(origin),
    "Access-Control-Allow-Methods": CORS_ALLOWED_METHODS.join(", "),
    "Access-Control-Allow-Headers": requestedHeaders?.trim() || CORS_ALLOWED_HEADERS.join(", "),
    "Access-Control-Max-Age": String(CORS_MAX_AGE_SECONDS),
    Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  };
}
