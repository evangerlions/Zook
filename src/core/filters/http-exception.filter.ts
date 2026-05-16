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
        : this.resolvePublicMessage(error, request);
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

  private resolvePublicMessage(error: ApplicationError, request: HttpRequest): string {
    if (this.shouldKeepPublicValidationMessage(error)) {
      return error.message;
    }

    return this.publicApiMessageService.fromErrorCode(
      error.code,
      request,
      error.message,
    ) ?? error.message;
  }

  private shouldKeepPublicValidationMessage(error: ApplicationError): boolean {
    if (error.code !== "REQ_INVALID_BODY") {
      return false;
    }

    if (!error.details || typeof error.details !== "object" || Array.isArray(error.details)) {
      return false;
    }

    const errors = (error.details as Record<string, unknown>).errors;
    return Array.isArray(errors) && errors.length > 0;
  }
}
