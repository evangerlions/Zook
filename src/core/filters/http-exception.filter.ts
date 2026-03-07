import { ApplicationError, isApplicationError } from "../../shared/errors.ts";
import type { HttpResponse } from "../../shared/types.ts";

/**
 * HttpExceptionFilter turns domain errors into the shared API envelope.
 */
export class HttpExceptionFilter {
  catch(error: unknown, requestId: string): HttpResponse<null> {
    if (isApplicationError(error)) {
      return {
        statusCode: error.statusCode,
        body: {
          code: error.code,
          message: error.message,
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
        message: internal.message,
        data: null,
        requestId,
      },
    };
  }
}
