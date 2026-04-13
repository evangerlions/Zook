import assert from "node:assert/strict";
import test from "node:test";
import { AppContextResolver } from "../../src/core/context/app-context.resolver.ts";

// --- Pre-auth resolution ---

test("AppContextResolver resolves appId from domain mapping", () => {
  const resolver = new AppContextResolver(new Map([["app.example.com", "app_123"]]));
  const appId = resolver.resolvePreAuth({
    method: "GET",
    path: "/",
    headers: {},
    hostname: "app.example.com",
  });
  assert.equal(appId, "app_123");
});

test("AppContextResolver resolves appId from X-App-Id header with trusted proxy", () => {
  const resolver = new AppContextResolver();
  const appId = resolver.resolvePreAuth({
    method: "GET",
    path: "/",
    headers: { "x-app-id": "app_456" },
    trustedProxy: true,
  });
  assert.equal(appId, "app_456");
});

test("AppContextResolver ignores X-App-Id header without trusted proxy and throws", () => {
  const resolver = new AppContextResolver();
  assert.throws(
    () => resolver.resolvePreAuth({
      method: "GET",
      path: "/",
      headers: { "x-app-id": "app_456" },
      trustedProxy: false,
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

test("AppContextResolver resolves appId from request body", () => {
  const resolver = new AppContextResolver();
  const appId = resolver.resolvePreAuth({
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {},
    body: { appId: "app_789", account: "test", password: "test" },
  });
  assert.equal(appId, "app_789");
});

test("AppContextResolver resolves appId from query string", () => {
  const resolver = new AppContextResolver();
  const appId = resolver.resolvePreAuth({
    method: "GET",
    path: "/api/v1/auth/login",
    headers: {},
    query: { appId: "app_q1" },
  });
  assert.equal(appId, "app_q1");
});

test("AppContextResolver prefers domain mapping over header and body", () => {
  const resolver = new AppContextResolver(new Map([["app.example.com", "app_domain"]]));
  const appId = resolver.resolvePreAuth({
    method: "POST",
    path: "/",
    headers: { "x-app-id": "app_header" },
    body: { appId: "app_body" },
    hostname: "app.example.com",
    trustedProxy: true,
  });
  assert.equal(appId, "app_domain");
});

test("AppContextResolver prefers X-App-Id over body when trusted", () => {
  const resolver = new AppContextResolver();
  const appId = resolver.resolvePreAuth({
    method: "POST",
    path: "/",
    headers: { "x-app-id": "app_header" },
    body: { appId: "app_body" },
    trustedProxy: true,
  });
  assert.equal(appId, "app_header");
});

test("AppContextResolver throws when no appId can be resolved", () => {
  const resolver = new AppContextResolver();
  assert.throws(
    () => resolver.resolvePreAuth({
      method: "GET",
      path: "/api/health",
      headers: {},
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

// --- Post-auth resolution ---

test("AppContextResolver returns tokenAppId when no X-App-Id header is present", () => {
  const resolver = new AppContextResolver();
  const appId = resolver.resolvePostAuth(
    { method: "GET", path: "/", headers: {} },
    "app_token",
  );
  assert.equal(appId, "app_token");
});

test("AppContextResolver returns tokenAppId when X-App-Id matches", () => {
  const resolver = new AppContextResolver();
  const appId = resolver.resolvePostAuth(
    { method: "GET", path: "/", headers: { "x-app-id": "app_token" } },
    "app_token",
  );
  assert.equal(appId, "app_token");
});

test("AppContextResolver throws when X-App-Id does not match tokenAppId", () => {
  const resolver = new AppContextResolver();
  assert.throws(
    () => resolver.resolvePostAuth(
      { method: "GET", path: "/", headers: { "x-app-id": "app_other" } },
      "app_token",
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "AUTH_APP_SCOPE_MISMATCH" &&
      error.statusCode === 403,
  );
});

// --- extractExplicitAppId ---

test("AppContextResolver extractExplicitAppId returns body.appId", () => {
  const resolver = new AppContextResolver();
  assert.equal(
    resolver.extractExplicitAppId({
      method: "POST",
      path: "/",
      headers: {},
      body: { appId: "app_from_body" },
    }),
    "app_from_body",
  );
});

test("AppContextResolver extractExplicitAppId returns query.appId", () => {
  const resolver = new AppContextResolver();
  assert.equal(
    resolver.extractExplicitAppId({
      method: "GET",
      path: "/",
      headers: {},
      query: { appId: "app_from_query" },
    }),
    "app_from_query",
  );
});

test("AppContextResolver extractExplicitAppId returns undefined for non-string body.appId", () => {
  const resolver = new AppContextResolver();
  assert.equal(
    resolver.extractExplicitAppId({
      method: "POST",
      path: "/",
      headers: {},
      body: { appId: 123 },
    }),
    undefined,
  );
});

test("AppContextResolver extractExplicitAppId returns undefined for array body", () => {
  const resolver = new AppContextResolver();
  assert.equal(
    resolver.extractExplicitAppId({
      method: "POST",
      path: "/",
      headers: {},
      body: [{ appId: "app_x" }],
    }),
    undefined,
  );
});
