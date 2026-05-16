import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCorsHeaders,
  buildCorsPreflightHeaders,
  resolveCorsDecision,
} from "../../src/infrastructure/http/cors.ts";

test("cors allowlist accepts localhost, 127.0.0.1 and configured domains", () => {
  assert.deepEqual(resolveCorsDecision("http://localhost:59986"), {
    allowed: true,
    origin: "http://localhost:59986",
  });
  assert.deepEqual(resolveCorsDecision("http://127.0.0.1:3211"), {
    allowed: true,
    origin: "http://127.0.0.1:3211",
  });
  assert.deepEqual(resolveCorsDecision("https://app-dev.youwoai.net"), {
    allowed: true,
    origin: "https://app-dev.youwoai.net",
  });
});

test("cors allowlist rejects unknown origins and allows missing origin", () => {
  assert.deepEqual(resolveCorsDecision(), { allowed: true });
  assert.deepEqual(resolveCorsDecision("https://evil.example.com"), {
    allowed: false,
    origin: "https://evil.example.com",
  });
});

test("cors headers include credential and preflight metadata", () => {
  assert.deepEqual(buildCorsHeaders("http://localhost:59986"), {
    "Access-Control-Allow-Origin": "http://localhost:59986",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Expose-Headers": "X-Request-Id",
    Vary: "Origin",
  });

  assert.deepEqual(buildCorsPreflightHeaders("http://localhost:59986"), {
    "Access-Control-Allow-Origin": "http://localhost:59986",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Expose-Headers": "X-Request-Id",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-App-Id, X-Platform, X-App-Version, X-Request-Id, X-App-Locale, X-App-Country-Code, X-Did, X-Log-Claim-Token, X-Log-Key-Id, X-Log-Enc, X-Log-Nonce, X-Log-Content, X-Log-Task-Id, X-Log-Line-Count, X-Log-Plain-Bytes, X-Log-Compressed-Bytes",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  });
});

test("cors preflight reflects requested headers when browser sends custom request headers", () => {
  assert.deepEqual(
    buildCorsPreflightHeaders(
      "http://localhost:59986",
      "authorization, content-type, x-did, x-log-enc, content-encoding",
    ),
    {
      "Access-Control-Allow-Origin": "http://localhost:59986",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Expose-Headers": "X-Request-Id",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "authorization, content-type, x-did, x-log-enc, content-encoding",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
    },
  );
});
