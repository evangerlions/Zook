import { ApplicationError, isApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import {
  buildEncryptedAiErrorPayload,
  buildLocalDebugAuditFileViewUrl,
  decryptAiRequestBody,
  encryptedAiResponse,
  encryptedAiStreamResponse,
  extractLocalAiDebugResponseText,
  handleEncryptedAiRequest,
  logEncryptedAiBusinessError,
  resolveAiNovelModelRoutingTier,
  shouldExposeLocalAiRequestDebugFields,
  shouldServeLocalDebugEndpoint,
} from "./encrypted-ai-routes.ts";
export async function tryHandleAiNovelRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "GET" && request.path === "/api/v1/ai_novel/statistics") return await handleAiNovelStatistics.call(this, request);
  if (request.method === "POST" && request.path === "/api/v1/ai_novel/statistics/snapshot") return await handleAiNovelStatisticsSnapshot.call(this, request);
  if (request.method === "POST" && request.path === "/api/v1/ai_novel/ai/chat-completions") return await handleAiNovelChatCompletions.call(this, request);
  if (request.method === "POST" && request.path === "/api/v1/ai_novel/ai/embeddings") return await handleAiNovelEmbeddings.call(this, request);
  const aiNovelAuditFileViewMatch = request.path.match(/^\/api\/v1\/ai_novel\/debug\/audit-file\/([^/]+)$/);
  if (request.method === "GET" && aiNovelAuditFileViewMatch) return await handleAiNovelAuditFileView.call(this, request, aiNovelAuditFileViewMatch[1] ?? "");
  if (request.method === "POST" && request.path === "/api/v1/ai_novel/debug/audit-file") return await handleAiNovelAuditFile.call(this, request);
  return undefined;
}

export async function handleAiNovelStatistics(this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticateProductRequest(request, "ai_novel");
  return this.ok(
    await this.aiNovelStatisticsService.getStatistics(auth),
    request.requestId as string,
  );
}

export async function handleAiNovelStatisticsSnapshot(this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticateProductRequest(request, "ai_novel");
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateAiNovelStatisticsSnapshot(body),
    request,
  );
  return this.ok(
    await this.aiNovelStatisticsService.recordSnapshot(auth, validated),
    request.requestId as string,
  );
}

export async function handleAiNovelChatCompletions(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticateProductRequest(request, "ai_novel");
  const routingTier = resolveAiNovelModelRoutingTier.call(this, auth);
  const { keyId, plaintext } = await decryptAiRequestBody.call(this, request);

  try {
    const parsed = JSON.parse(plaintext.toString("utf8"));
    const body = this.validationPipe.asObject(parsed);
    const stream = body.stream === true;
    if (!stream && body.stream !== undefined && body.stream !== false) {
      throw new ApplicationError(
        400,
        "REQ_INVALID_BODY",
        "stream must be a boolean when provided.",
      );
    }

    if (stream) {
      return encryptedAiStreamResponse.call(this, 
        request,
        keyId,
        this.aiNovelLlmService.createChatCompletionStream(body, {
          exposeLocalDebug:
            shouldExposeLocalAiRequestDebugFields.call(this, request),
          requestId: request.requestId as string,
          routingTier,
          userId: auth.userId,
          locale: this.resolveRequestLocale(request),
          signal: request.signal,
        }),
      );
    }

    const result = await this.aiNovelLlmService.createChatCompletion(body, {
      exposeLocalDebug: shouldExposeLocalAiRequestDebugFields.call(this, request),
      requestId: request.requestId as string,
      routingTier,
      userId: auth.userId,
      locale: this.resolveRequestLocale(request),
    });
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

export async function handleAiNovelEmbeddings(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  return handleEncryptedAiRequest.call(this, request, async (body, auth) => {
    return await this.aiNovelLlmService.createEmbeddings(body, {
      requestId: request.requestId as string,
      routingTier: resolveAiNovelModelRoutingTier.call(this, auth),
      userId: auth.userId,
    });
  });
}

export async function handleAiNovelAuditFile(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  if (!shouldServeLocalDebugEndpoint.call(this, request)) {
    throw new ApplicationError(404, "REQ_INVALID_BODY", "Route not found.");
  }

  await this.authenticateProductRequest(request, "ai_novel");
  const body = this.validationPipe.asObject(request.body);
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const html = typeof body.html === "string" ? body.html : "";
  if (sessionId.trim().isEmpty) {
    throw new ApplicationError(
      400,
      "REQ_INVALID_BODY",
      "sessionId is required.",
    );
  }
  if (html.trim().isEmpty) {
    throw new ApplicationError(400, "REQ_INVALID_BODY", "html is required.");
  }

  const result = await this.aiNovelAuditFileService.writeAuditFile({
    sessionId,
    html,
  });
  return this.ok(
    {
      ...result,
      viewUrl: buildLocalDebugAuditFileViewUrl.call(this, request, sessionId),
    },
    request.requestId as string,
  );
}

export async function handleAiNovelAuditFileView(this: BackendRouteContext, 
  request: HttpRequest,
  encodedSessionId: string,
): Promise<HttpResponse<unknown>> {
  if (!shouldServeLocalDebugEndpoint.call(this, request)) {
    throw new ApplicationError(404, "REQ_INVALID_BODY", "Route not found.");
  }
  const sessionId = decodeURIComponent(encodedSessionId);
  if (sessionId.trim().isEmpty) {
    throw new ApplicationError(
      400,
      "REQ_INVALID_BODY",
      "sessionId is required.",
    );
  }
  const html = await this.aiNovelAuditFileService.readAuditFile(sessionId);
  return {
    statusCode: 200,
    contentType: "text/html; charset=utf-8",
    headers: {
      "Cache-Control": "no-store",
    },
    body: {
      code: "OK",
      message: "success",
      data: null,
      requestId: request.requestId as string,
    },
    streamBody: (async function* () {
      yield html;
    })(),
  };
}
