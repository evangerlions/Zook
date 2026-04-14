import { ApplicationError, isApplicationError } from "../../shared/errors.ts";
import type { HttpResponse } from "../../shared/types.ts";
import type { HttpRequest } from "../../shared/types.ts";
import { PublicApiMessageService } from "../../services/public-api-message.service.ts";

/**
 * HttpExceptionFilter turns domain errors into the shared API envelope.
 */
export class HttpExceptionFilter {
  constructor(
    private readonly publicApiMessageService = new PublicApiMessageService(),
  ) {}

  catch(error: unknown, request: HttpRequest, requestId: string): HttpResponse<null> {
    if (isApplicationError(error)) {
      const localized = request.path.startsWith("/api/v1/admin")
        ? error.message
        : this.publicApiMessageService.fromErrorCode(
            error.code,
            request,
            error.message,
          ) ?? error.message;
      return {
        statusCode: error.statusCode,
        body: {
          code: error.code,
          message: localized,
          data: null,
          requestId,
        },
      };
    }

    const internal = new ApplicationError(
      500,
      "SYS_INTERNAL_ERROR",
      "An unexpected internal error occurred.",
    );

    return {
      statusCode: internal.statusCode,
      body: {
        code: internal.code,
        message: request.path.startsWith("/api/v1/admin")
          ? internal.message
          : this.publicApiMessageService.fromErrorCode(
              internal.code,
              request,
              internal.message,
            ) ?? internal.message,
        data: null,
        requestId,
      },
    };
  }
}
