const ADMIN_API_PREFIX = "/api/v1/admin";

export const ADMIN_AUTH_REQUIRED_EVENT = "zook.admin.auth-required";

interface ApiEnvelope<T> {
  code: string;
  message: string;
  data: T;
  requestId: string;
}

export class ApiError extends Error {
  statusCode: number;
  code?: string;
  data?: unknown;

  constructor(message: string, statusCode: number, code?: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.data = data;
  }
}

export function adminPath(pathname: string): string {
  return `${ADMIN_API_PREFIX}${pathname}`;
}

async function parseResponsePayload<T>(response: Response): Promise<ApiEnvelope<T>> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json() as Promise<ApiEnvelope<T>>;
  }

  return {
    code: response.ok ? "OK" : "HTTP_ERROR",
    message: await response.text(),
    data: null as T,
    requestId: "admin_plain_text",
  };
}

function shouldRedirectToLogin(response: Response, payload?: ApiEnvelope<unknown>) {
  if (response.status === 401) {
    return true;
  }
  if (payload?.code === "ADMIN_AUTH_REQUIRED" || payload?.code === "ADMIN_BASIC_AUTH_REQUIRED") {
    return true;
  }
  const message = String(payload?.message ?? "").toLowerCase();
  return message.includes("admin authentication is required")
    || message.includes("admin basic authentication is required");
}

function dispatchAuthRequired(message: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ADMIN_AUTH_REQUIRED_EVENT, { detail: { message } }));
  }
}

export async function requestJson<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string | undefined>;
  } = {},
): Promise<T> {
  const requestHeaders = new Headers({ Accept: "application/json" });
  Object.entries(options.headers ?? {}).forEach(([key, value]) => {
    if (value) {
      requestHeaders.set(key, value);
    }
  });
  if (options.body !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: requestHeaders,
    credentials: "include",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await parseResponsePayload<T>(response);
  if (!response.ok) {
    if (shouldRedirectToLogin(response, payload)) {
      dispatchAuthRequired(payload.message || "登录已失效，请重新登录。");
    }
    throw new ApiError(
      payload.message || `Request failed with status ${response.status}`,
      response.status,
      payload.code,
      payload.data,
    );
  }
  return payload.data;
}

export function isAdminAuthError(error: unknown): boolean {
  return error instanceof ApiError && (
    error.statusCode === 401
    || error.code === "ADMIN_AUTH_REQUIRED"
    || error.code === "ADMIN_BASIC_AUTH_REQUIRED"
  );
}
