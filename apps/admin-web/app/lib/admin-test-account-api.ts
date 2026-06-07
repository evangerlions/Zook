import {
  ADMIN_AUTH_REQUIRED_EVENT,
  ApiError,
} from "./admin-api";
import type {
  AdminTestAccountDocument,
  AdminTestAccountRevealDocument,
} from "./types";

const ADMIN_API_PREFIX = "/api/v1/admin";

interface ApiEnvelope<T> {
  code: string;
  message: string;
  data: T;
  requestId: string;
}

function adminPath(pathname: string): string {
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
  return response.status === 401
    || payload?.code === "ADMIN_AUTH_REQUIRED"
    || payload?.code === "ADMIN_BASIC_AUTH_REQUIRED";
}

function dispatchAuthRequired(message: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(ADMIN_AUTH_REQUIRED_EVENT, {
      detail: { message },
    }),
  );
}

async function requestJson<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
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

export const adminTestAccountApi = {
  getTestAccounts() {
    return requestJson<AdminTestAccountDocument>(adminPath("/apps/common/test-accounts"));
  },
  createTestAccount(input: Record<string, unknown>) {
    return requestJson<AdminTestAccountDocument>(adminPath("/apps/common/test-accounts"), {
      method: "POST",
      body: input,
    });
  },
  updateTestAccount(id: string, input: Record<string, unknown>) {
    return requestJson<AdminTestAccountDocument>(
      adminPath(`/apps/common/test-accounts/${encodeURIComponent(id)}`),
      {
        method: "PUT",
        body: input,
      },
    );
  },
  deleteTestAccount(id: string) {
    return requestJson<AdminTestAccountDocument>(
      adminPath(`/apps/common/test-accounts/${encodeURIComponent(id)}`),
      { method: "DELETE" },
    );
  },
  resetTestAccountCode(id: string) {
    return requestJson<AdminTestAccountDocument>(
      adminPath(`/apps/common/test-accounts/${encodeURIComponent(id)}/reset-code`),
      { method: "POST" },
    );
  },
  revealTestAccountCode(id: string) {
    return requestJson<AdminTestAccountRevealDocument>(
      adminPath(`/apps/common/test-accounts/${encodeURIComponent(id)}/reveal-code`),
      { method: "POST" },
    );
  },
};
