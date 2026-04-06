import type {
  AdminAppSummary,
  AdminAppLogSecretRevealDocument,
  AdminBootstrapResult,
  AdminConfigDocument,
  AdminDeleteAppResult,
  AdminEmailServiceDocument,
  AdminEmailTestSendCommand,
  AdminEmailTestSendDocument,
  AdminRemoteLogPullSettingsDocument,
  AdminRemoteLogPullTaskListDocument,
  AdminLlmMetricsDocument,
  AdminLlmModelMetricsDocument,
  AdminLlmServiceDocument,
  AdminLlmSmokeTestDocument,
  AdminPasswordDocument,
  AdminPasswordRevealDocument,
  AdminSensitiveOperationCodeRequestDocument,
  AdminSensitiveOperationGrantDocument,
  LlmMetricsRange,
} from "./types";

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
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(ADMIN_AUTH_REQUIRED_EVENT, {
      detail: {
        message,
      },
    }),
  );
}

async function requestJson<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string | undefined>;
  } = {},
): Promise<T> {
  const requestHeaders = new Headers({
    Accept: "application/json",
  });

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
  if (!(error instanceof ApiError)) {
    return false;
  }

  return error.statusCode === 401
    || error.code === "ADMIN_AUTH_REQUIRED"
    || error.code === "ADMIN_BASIC_AUTH_REQUIRED";
}

export const adminApi = {
  login(username: string, password: string) {
    return requestJson<AdminBootstrapResult & { sessionExpiresAt?: string }>(
      adminPath("/auth/login"),
      {
        method: "POST",
        body: {
          username,
          password,
        },
      },
    );
  },
  logout() {
    return requestJson<{ loggedOut: true }>(adminPath("/auth/logout"), {
      method: "POST",
    });
  },
  bootstrap() {
    return requestJson<AdminBootstrapResult>(adminPath("/bootstrap"));
  },
  requestSensitiveOperationCode(operation: string) {
    return requestJson<AdminSensitiveOperationCodeRequestDocument>(
      adminPath("/sensitive-operations/request-code"),
      {
        method: "POST",
        body: {
          operation,
        },
      },
    );
  },
  verifySensitiveOperationCode(operation: string, code: string) {
    return requestJson<AdminSensitiveOperationGrantDocument>(
      adminPath("/sensitive-operations/verify"),
      {
        method: "POST",
        body: {
          operation,
          code,
        },
      },
    );
  },
  createApp(appId: string, appNameZhCn: string, appNameEnUs: string) {
    return requestJson<AdminAppSummary>(adminPath("/apps"), {
      method: "POST",
      body: {
        appId,
        appNameZhCn,
        appNameEnUs,
      },
    });
  },
  updateAppNames(appId: string, appNameI18n: Record<string, string>) {
    return requestJson<AdminAppSummary>(adminPath(`/apps/${encodeURIComponent(appId)}/names`), {
      method: "PUT",
      body: {
        appNameI18n,
      },
    });
  },
  revealAppLogSecret(appId: string) {
    return requestJson<AdminAppLogSecretRevealDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/log-secret/reveal`),
      {
        method: "POST",
      },
    );
  },
  deleteApp(appId: string) {
    return requestJson<AdminDeleteAppResult>(adminPath(`/apps/${encodeURIComponent(appId)}`), {
      method: "DELETE",
    });
  },
  getConfig(appId: string) {
    return requestJson<AdminConfigDocument>(adminPath(`/apps/${encodeURIComponent(appId)}/config`));
  },
  getConfigRevision(appId: string, revision: number) {
    return requestJson<AdminConfigDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/config/revisions/${revision}`),
    );
  },
  updateConfig(appId: string, rawJson: string, desc?: string) {
    return requestJson<AdminConfigDocument>(adminPath(`/apps/${encodeURIComponent(appId)}/config`), {
      method: "PUT",
      body: {
        rawJson,
        desc: desc || undefined,
      },
    });
  },
  restoreConfig(appId: string, revision: number, desc?: string) {
    return requestJson<AdminConfigDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/config/revisions/${revision}/restore`),
      {
        method: "POST",
        body: {
          desc: desc || undefined,
        },
      },
    );
  },
  getRemoteLogPull(appId: string) {
    return requestJson<AdminRemoteLogPullSettingsDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull`),
    );
  },
  getRemoteLogPullRevision(appId: string, revision: number) {
    return requestJson<AdminRemoteLogPullSettingsDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull/revisions/${revision}`),
    );
  },
  updateRemoteLogPull(appId: string, config: unknown, desc?: string) {
    return requestJson<AdminRemoteLogPullSettingsDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull`),
      {
        method: "PUT",
        body: {
          config,
          desc: desc || undefined,
        },
      },
    );
  },
  restoreRemoteLogPull(appId: string, revision: number, desc?: string) {
    return requestJson<AdminRemoteLogPullSettingsDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull/revisions/${revision}/restore`),
      {
        method: "POST",
        body: {
          desc: desc || undefined,
        },
      },
    );
  },
  listRemoteLogPullTasks(appId: string) {
    return requestJson<AdminRemoteLogPullTaskListDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull/tasks`),
    );
  },
  createRemoteLogPullTask(appId: string, userId: string, did: string) {
    return requestJson<AdminRemoteLogPullTaskListDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull/tasks`),
      {
        method: "POST",
        body: {
          userId,
          did,
        },
      },
    );
  },
  cancelRemoteLogPullTask(appId: string, taskId: string) {
    return requestJson<AdminRemoteLogPullTaskListDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull/tasks/${encodeURIComponent(taskId)}/cancel`),
      {
        method: "POST",
      },
    );
  },
  getEmailService() {
    return requestJson<AdminEmailServiceDocument>(adminPath("/apps/common/email-service"));
  },
  getEmailServiceRevision(revision: number) {
    return requestJson<AdminEmailServiceDocument>(adminPath(`/apps/common/email-service/revisions/${revision}`));
  },
  updateEmailService(input: Record<string, unknown>) {
    return requestJson<AdminEmailServiceDocument>(adminPath("/apps/common/email-service"), {
      method: "PUT",
      body: input,
    });
  },
  restoreEmailService(revision: number, desc?: string) {
    return requestJson<AdminEmailServiceDocument>(
      adminPath(`/apps/common/email-service/revisions/${revision}/restore`),
      {
        method: "POST",
        body: {
          desc: desc || undefined,
        },
      },
    );
  },
  sendEmailTest(input: AdminEmailTestSendCommand) {
    return requestJson<AdminEmailTestSendDocument>(adminPath("/apps/common/email-service/test-send"), {
      method: "POST",
      body: input,
    });
  },
  getPasswords() {
    return requestJson<AdminPasswordDocument>(adminPath("/apps/common/passwords"));
  },
  upsertPasswordItem(input: Record<string, unknown>) {
    return requestJson<AdminPasswordDocument>(adminPath("/apps/common/passwords/item"), {
      method: "PUT",
      body: input,
    });
  },
  deletePasswordItem(key: string) {
    return requestJson<AdminPasswordDocument>(adminPath(`/apps/common/passwords/${encodeURIComponent(key)}`), {
      method: "DELETE",
    });
  },
  revealPasswordValue(key: string) {
    return requestJson<AdminPasswordRevealDocument>(
      adminPath(`/apps/common/passwords/${encodeURIComponent(key)}/reveal`),
      {
        method: "POST",
      },
    );
  },
  getLlmService() {
    return requestJson<AdminLlmServiceDocument>(adminPath("/apps/common/llm-service"));
  },
  getLlmServiceRevision(revision: number) {
    return requestJson<AdminLlmServiceDocument>(adminPath(`/apps/common/llm-service/revisions/${revision}`));
  },
  updateLlmService(input: Record<string, unknown>) {
    return requestJson<AdminLlmServiceDocument>(adminPath("/apps/common/llm-service"), {
      method: "PUT",
      body: input,
    });
  },
  restoreLlmService(revision: number, desc?: string) {
    return requestJson<AdminLlmServiceDocument>(
      adminPath(`/apps/common/llm-service/revisions/${revision}/restore`),
      {
        method: "POST",
        body: {
          desc: desc || undefined,
        },
      },
    );
  },
  getLlmMetrics(range: LlmMetricsRange) {
    return requestJson<AdminLlmMetricsDocument>(
      adminPath(`/apps/common/llm-service/metrics?range=${encodeURIComponent(range)}`),
    );
  },
  getLlmModelMetrics(modelKey: string, range: LlmMetricsRange) {
    return requestJson<AdminLlmModelMetricsDocument>(
      adminPath(
        `/apps/common/llm-service/metrics/models/${encodeURIComponent(modelKey)}?range=${encodeURIComponent(range)}`,
      ),
    );
  },
  runLlmSmokeTest() {
    return requestJson<AdminLlmSmokeTestDocument>(adminPath("/apps/common/llm-service/smoke-test"), {
      method: "POST",
    });
  },
};
