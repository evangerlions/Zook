import { ApplicationError, isApplicationError } from "../shared/errors.ts";
import type {
  AiNovelModelRoutingTier,
  AuthContext,
  HttpRequest,
  HttpResponse,
} from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";
import {
  AesGcmPayloadCryptoError,
  type AesGcmJsonEnvelope,
} from "../services/aes-gcm-payload-crypto.service.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

export async function handleEncryptedAiRequest(this: BackendRouteContext, 
  request: HttpRequest,
  handler: (
    body: Record<string, unknown>,
    auth: AuthContext,
  ) => Promise<unknown>,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticateProductRequest(request, "ai_novel");
  const { keyId, plaintext } = await decryptAiRequestBody.call(this, request);

  try {
    const parsed = JSON.parse(plaintext.toString("utf8"));
    const body = this.validationPipe.asObject(parsed);
    const result = await handler(body, auth);
    const localDebugResponseText =
      extractLocalAiDebugResponseText.call(this, result);
    return await encryptedAiResponse.call(this, 
      request,
      keyId,
      {
        code: "OK",
        message: "success",
        data: result,
        requestId: request.requestId as string,
      },
      localDebugResponseText,
    );
  } catch (error) {
    const applicationError =
      error instanceof SyntaxError
        ? new ApplicationError(
            400,
            "REQ_INVALID_BODY",
            "Decrypted AI request body must be valid JSON.",
          )
        : error;
    if (!isApplicationError(applicationError)) {
      throw error;
    }

    logEncryptedAiBusinessError.call(this, request, applicationError, "response");
    return await encryptedAiResponse.call(this, 
      request,
      keyId,
      buildEncryptedAiErrorPayload.call(this, 
        request,
        applicationError,
        request.requestId as string,
      ),
    );
  }
}

export function resolveAiNovelModelRoutingTier(this: BackendRouteContext, 
  auth: AuthContext,
): AiNovelModelRoutingTier {
  void auth;
  return "free";
}

export async function decryptAiRequestBody(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<{ keyId: string; plaintext: Buffer }> {
  const envelope = this.validationPipe.asObject(request.body);
  let decrypted: { keyId: string; plaintext: Buffer };
  try {
    decrypted =
      await this.aiPayloadCryptoService.decryptJsonEnvelope(envelope);
  } catch (error) {
    mapAiCryptoError.call(this, error);
  }

  return decrypted;
}

export async function encryptedAiResponse(this: BackendRouteContext, 
  request: HttpRequest,
  keyId: string,
  payload: {
    code: string;
    message: string;
    data: unknown;
    requestId: string;
  },
  localDebugResponseText?: string,
): Promise<HttpResponse<unknown>> {
  let encrypted: AesGcmJsonEnvelope;
  try {
    encrypted = await this.aiPayloadCryptoService.encryptJsonEnvelope(
      Buffer.from(JSON.stringify(payload), "utf8"),
      keyId,
    );
  } catch (error) {
    mapAiCryptoError.call(this, error);
  }

  return {
    statusCode: 200,
    body: {
      ...encrypted,
      ...(shouldExposeLocalAiDebugFields.call(this, request) &&
      localDebugResponseText
        ? { localDebugResponseText }
        : {}),
    } as unknown as never,
  };
}

export function encryptedAiStreamResponse(this: BackendRouteContext, 
  request: HttpRequest,
  keyId: string,
  stream: AsyncIterable<unknown>,
): HttpResponse<unknown> {
  const requestId = request.requestId as string;
  const shouldExposeLocalDebug = shouldExposeLocalAiDebugFields.call(this, request);

  const streamBody = createEncryptedAiSseStream.call(
    this,
    request,
    keyId,
    requestId,
    stream,
    shouldExposeLocalDebug,
  );

  return {
    statusCode: 200,
    contentType: "text/event-stream; charset=utf-8",
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
    body: {
      code: "OK",
      message: "streaming",
      data: null,
      requestId,
    } as unknown as never,
    streamBody,
  };
}

async function *createEncryptedAiSseStream(
  this: BackendRouteContext,
  request: HttpRequest,
  keyId: string,
  requestId: string,
  stream: AsyncIterable<unknown>,
  shouldExposeLocalDebug: boolean,
): AsyncIterable<string> {
  try {
    for await (const item of stream) {
      const payload = {
        code: "OK",
        message: "success",
        data: item,
        requestId,
      };
      const encrypted = await this.aiPayloadCryptoService.encryptJsonEnvelope(
        Buffer.from(JSON.stringify(payload), "utf8"),
        keyId,
      );
      const localDebugResponseText = shouldExposeLocalDebug
        ? extractLocalAiDebugCompletionText.call(this, 
            item && typeof item === "object" && !Array.isArray(item)
              ? (item as Record<string, unknown>).completion
              : undefined,
          )
        : undefined;
      const eventPayload = {
        ...encrypted,
        ...(localDebugResponseText ? { localDebugResponseText } : {}),
      };
      yield `data: ${JSON.stringify(eventPayload)}\n\n`;
    }
  } catch (error) {
    const applicationError = isApplicationError(error)
      ? error
      : new ApplicationError(
          500,
          "SYS_INTERNAL_ERROR",
          "An unexpected internal error occurred.",
        );
    logEncryptedAiBusinessError.call(this, request, applicationError, "stream");
    const encrypted = await this.aiPayloadCryptoService.encryptJsonEnvelope(
      Buffer.from(
        JSON.stringify(
          buildEncryptedAiErrorPayload.call(this, 
            request,
            applicationError,
            requestId,
          ),
        ),
        "utf8",
      ),
      keyId,
    );
    yield `data: ${JSON.stringify(encrypted)}\n\n`;
  }
}

export function logEncryptedAiBusinessError(this: BackendRouteContext, 
  request: HttpRequest,
  error: ApplicationError,
  transport: "response" | "stream",
): void {
  this.logger.error("encrypted ai business error", {
    requestId: request.requestId,
    appId: request.auth?.appId,
    userId: request.auth?.userId,
    path: request.path,
    transport,
    statusCode: error.statusCode,
    code: error.code,
    errorMessage: error.message,
    detailsPreview: previewAppLogValue(error.details),
  });
}

export function localizePublicErrorMessage(this: BackendRouteContext, 
  error: ApplicationError,
  request: HttpRequest,
): string {
  return (
    this.publicApiMessageService.fromErrorCode(
      error.code,
      request,
      error.message,
    ) ?? error.message
  );
}

export function buildEncryptedAiErrorPayload(this: BackendRouteContext, 
  request: HttpRequest,
  error: ApplicationError,
  requestId: string,
): {
  code: string;
  message: string;
  data: unknown;
  requestId: string;
} {
  return {
    code: error.code,
    message: localizePublicErrorMessage.call(this, error, request),
    data: shouldExposeLocalAiDebugFields.call(this, request)
      ? buildLocalAiErrorDebugDetails.call(this, error)
      : null,
    requestId,
  };
}

export function buildLocalAiErrorDebugDetails(this: BackendRouteContext, 
  error: ApplicationError,
): Record<string, unknown> {
  const detailObject =
    error.details &&
    typeof error.details === "object" &&
    !Array.isArray(error.details)
      ? (error.details as Record<string, unknown>)
      : {};
  return {
    statusCode: error.statusCode,
    code: error.code,
    provider: detailObject.provider,
    providerStatusCode: detailObject.statusCode,
    providerErrorCode: detailObject.errorCode,
    providerErrorType: detailObject.errorType,
    providerRequestId: detailObject.providerRequestId,
    upstreamReason: detailObject.reason,
    upstreamCause: detailObject.cause,
    timeoutMs: detailObject.timeoutMs,
    detailsPreview: previewAppLogValue(error.details),
  };
}

export function shouldExposeLocalAiDebugFields(this: BackendRouteContext, request: HttpRequest): boolean {
  if (isOnlineOrProductionRuntime.call(this, )) {
    return false;
  }
  const host =
    getHeader(request.headers, "x-forwarded-host") ??
    getHeader(request.headers, "host") ??
    "";
  return (
    isLocalOrDevRuntime.call(this, ) ||
    /(?:^|:\/\/)(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(host) ||
    /(?:127\.0\.0\.1|localhost)(?::\d+)?/i.test(host)
  );
}

export function isOnlineOrProductionRuntime(this: BackendRouteContext): boolean {
  const appEnv = String(process.env.APP_ENV ?? "")
    .trim()
    .toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV ?? "")
    .trim()
    .toLowerCase();
  if (appEnv === "online" || appEnv === "prod" || appEnv === "production") {
    return true;
  }
  return !appEnv && nodeEnv === "production";
}

export function isLocalOrDevRuntime(this: BackendRouteContext): boolean {
  const appEnv = String(process.env.APP_ENV ?? "")
    .trim()
    .toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV ?? "")
    .trim()
    .toLowerCase();
  if (isOnlineOrProductionRuntime.call(this, )) {
    return false;
  }
  return (
    appEnv === "dev" ||
    appEnv === "development" ||
    appEnv === "local" ||
    appEnv === "test" ||
    nodeEnv === "development" ||
    nodeEnv === "test"
  );
}

export function shouldServeLocalDebugEndpoint(this: BackendRouteContext, request: HttpRequest): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    shouldExposeLocalAiDebugFields.call(this, request)
  );
}

export function buildLocalDebugAuditFileViewUrl(this: BackendRouteContext, 
  request: HttpRequest,
  sessionId: string,
): string {
  const host =
    getHeader(request.headers, "x-forwarded-host") ??
    getHeader(request.headers, "host") ??
    "localhost";
  const protocol = getHeader(request.headers, "x-forwarded-proto") ?? "http";
  return `${protocol}://${host}/api/v1/ai_novel/debug/audit-file/${encodeURIComponent(
    this.aiNovelAuditFileService.sanitizeSessionId(sessionId),
  )}`;
}

export function shouldExposeLocalAiRequestDebugFields(this: BackendRouteContext, request: HttpRequest): boolean {
  if (!shouldExposeLocalAiDebugFields.call(this, request)) {
    return false;
  }
  const body = request.body;
  return Boolean(
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as Record<string, unknown>).localDebugRequestPlaintext ===
      "string",
  );
}

export function extractLocalAiDebugResponseText(this: BackendRouteContext, result: unknown): string | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }

  const completion = (result as Record<string, unknown>).completion;
  return extractLocalAiDebugCompletionText.call(this, completion);
}

export function extractLocalAiDebugCompletionText(this: BackendRouteContext, 
  completion: unknown,
): string | undefined {
  if (
    !completion ||
    typeof completion !== "object" ||
    Array.isArray(completion)
  ) {
    return undefined;
  }

  const content = (completion as Record<string, unknown>).content;
  if (typeof content !== "string") {
    return undefined;
  }

  const trimmed = content.trim();
  return trimmed ? trimmed : undefined;
}

export function mapAiCryptoError(this: BackendRouteContext, error: unknown): never {
  if (!(error instanceof AesGcmPayloadCryptoError)) {
    throw error;
  }

  switch (error.code) {
    case "UNSUPPORTED_ALGORITHM":
      throw new ApplicationError(
        400,
        "AI_UNSUPPORTED_ALGORITHM",
        "Unsupported AI encryption algorithm.",
      );
    case "UNKNOWN_KEY":
      throw new ApplicationError(
        400,
        "AI_UNKNOWN_KEY_ID",
        "Unknown AI encryption key id.",
      );
    case "INVALID_ENVELOPE":
      throw new ApplicationError(
        400,
        "REQ_INVALID_BODY",
        "Encrypted AI request envelope is invalid.",
      );
    case "INVALID_NONCE":
    case "PAYLOAD_TOO_SMALL":
    case "DECRYPT_FAILED":
      throw new ApplicationError(
        400,
        "AI_DECRYPT_FAILED",
        "Unable to decrypt AI payload.",
      );
    case "ENCRYPT_FAILED":
      throw new ApplicationError(
        500,
        "AI_ENCRYPT_FAILED",
        "Unable to encrypt AI response.",
      );
  }
}

function previewAppLogValue(value: unknown, limit = 1200): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const text = typeof value === "string" ? value : safeAppJsonStringify(value);
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function safeAppJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
