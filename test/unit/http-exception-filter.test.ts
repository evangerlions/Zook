import assert from "node:assert/strict";
import test from "node:test";
import { HttpExceptionFilter } from "../../src/core/filters/http-exception.filter.ts";
import {
  ApplicationError,
  badRequest,
  forbidden,
  internalError,
  unauthorized,
} from "../../src/shared/errors.ts";

const filter = new HttpExceptionFilter();
const publicRequest = {
  method: "GET",
  path: "/api/v1/demo/public",
  headers: {},
} as const;

// --- ApplicationError handling ---

test("HttpExceptionFilter converts ApplicationError to HttpResponse envelope", () => {
  const response = filter.catch(
    new ApplicationError(400, "REQ_INVALID_BODY", "Bad request", {
      field: "email",
    }),
    publicRequest,
    "req_001",
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    code: "REQ_INVALID_BODY",
    message: "Bad request",
    data: null,
    requestId: "req_001",
  });
});

test("HttpExceptionFilter passes through 401 errors", () => {
  let err: unknown;
  try {
    unauthorized("AUTH_BEARER_REQUIRED", "Token required");
  } catch (e) {
    err = e;
  }
  const response = filter.catch(err as Error, publicRequest, "req_002");

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, "AUTH_BEARER_REQUIRED");
});

test("HttpExceptionFilter passes through 403 errors", () => {
  let err: unknown;
  try {
    forbidden("AUTH_APP_SCOPE_MISMATCH", "Scope mismatch");
  } catch (e) {
    err = e;
  }
  const response = filter.catch(err as Error, publicRequest, "req_003");

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "AUTH_APP_SCOPE_MISMATCH");
});

test("HttpExceptionFilter includes details in ApplicationError", () => {
  const response = filter.catch(
    new ApplicationError(400, "REQ_INVALID_BODY", "Invalid", { extra: true }),
    publicRequest,
    "req_004",
  );

  assert.equal(response.body.code, "REQ_INVALID_BODY");
  assert.equal(response.body.message, "Invalid");
  assert.equal(response.body.data, null);
});

// --- Unknown errors ---

test("HttpExceptionFilter converts unknown errors to 500 SYS_INTERNAL_ERROR", () => {
  const response = filter.catch(
    new Error("Something went wrong"),
    publicRequest,
    "req_005",
  );

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.code, "SYS_INTERNAL_ERROR");
  assert.equal(response.body.message, "An unexpected internal error occurred.");
  assert.equal(response.body.data, null);
  assert.equal(response.body.requestId, "req_005");
});

test("HttpExceptionFilter converts non-Error objects to 500", () => {
  const response = filter.catch("string error", publicRequest, "req_006");

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.code, "SYS_INTERNAL_ERROR");
});

test("HttpExceptionFilter converts null to 500", () => {
  const response = filter.catch(null, publicRequest, "req_007");

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.code, "SYS_INTERNAL_ERROR");
});

// --- Specific error helpers ---

test("HttpExceptionFilter handles badRequest helper", () => {
  assert.throws(
    () => badRequest("REQ_INVALID_BODY", "Missing field"),
    (error: unknown) => {
      if (error instanceof ApplicationError) {
        const response = filter.catch(error, publicRequest, "req_008");
        assert.equal(response.statusCode, 400);
        assert.equal(response.body.code, "REQ_INVALID_BODY");
        return true;
      }
      return false;
    },
  );
});

test("HttpExceptionFilter handles internalError helper", () => {
  assert.throws(
    () => internalError("Database connection lost"),
    (error: unknown) => {
      if (error instanceof ApplicationError) {
        const response = filter.catch(error, publicRequest, "req_009");
        assert.equal(response.statusCode, 500);
        assert.equal(response.body.code, "SYS_INTERNAL_ERROR");
        return true;
      }
      return false;
    },
  );
});
