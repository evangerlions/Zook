import { createHash, createHmac, randomBytes } from "node:crypto";
import { ApplicationError } from "../shared/errors.ts";
import type { TransparentProxyConfig } from "../shared/types.ts";

export const OPENROUTER_HMAC_VERSION = "oa-hmac-v1";
export const OPENROUTER_PROXY_HEADERS = Object.freeze({
  keyId: "x-proxy-key-id",
  timestamp: "x-proxy-timestamp",
  nonce: "x-proxy-nonce",
  signature: "x-proxy-signature",
});

export interface TransparentProxyFetchOptions {
  resolveConfig: () => Promise<TransparentProxyConfig>;
  resolveSecret: (key: string) => Promise<string | undefined>;
  fetchImplementation?: typeof fetch;
  nowSeconds?: () => number;
  createNonce?: () => string;
  onProxyRequest?: (details: {
    method: string;
    requestTarget: string;
    proxyHost: string;
    keyId: string;
  }) => void;
}

interface OpenRouterSignatureInput {
  keyId: string;
  encodedSecret: string;
  method: string;
  requestTarget: string;
  timestamp: string;
  nonce: string;
  authorization: string;
}

export function createOpenRouterTransparentProxyFetch(
  options: TransparentProxyFetchOptions,
): typeof fetch {
  return createTransparentProxyFetch(options, isOpenRouterUrl, "OpenRouter");
}

export function createTransparentProxyFetch(
  options: TransparentProxyFetchOptions,
  shouldProxyUrl: (url: URL) => boolean,
  providerLabel: string,
): typeof fetch {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new Error("fetch is not available in the current runtime.");
  }

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const sourceUrl = new URL(input instanceof Request ? input.url : String(input));
    if (!shouldProxyUrl(sourceUrl)) {
      return fetchImplementation(input, init);
    }

    const config = await options.resolveConfig();
    if (!config.useTransparentProxy) {
      return fetchImplementation(input, init);
    }

    const encodedSecret = (
      await options.resolveSecret(config.transparentProxyHmacSecretKey)
    )?.trim();
    if (!encodedSecret) {
      return fetchImplementation(input, init);
    }

    assertValidHmacSecret(encodedSecret, providerLabel);
    const method = resolveMethod(input, init);
    const proxyUrl = buildProxyUrl(sourceUrl, config.transparentProxyBaseUrl);
    const headers = mergeHeaders(input, init);
    const timestamp = String(
      Math.floor(options.nowSeconds?.() ?? Date.now() / 1_000),
    );
    const nonce = options.createNonce?.() ?? randomBytes(16).toString("base64url");
    const requestTarget = `${proxyUrl.pathname}${proxyUrl.search}`;
    const signedHeaders = createOpenRouterProxyHeaders({
      keyId: config.transparentProxyKeyId,
      encodedSecret,
      method,
      requestTarget,
      timestamp,
      nonce,
      authorization: headers.get("authorization") ?? "",
    });
    for (const [key, value] of Object.entries(signedHeaders)) {
      headers.set(key, value);
    }

    options.onProxyRequest?.({
      method,
      requestTarget,
      proxyHost: proxyUrl.host,
      keyId: config.transparentProxyKeyId,
    });
    return fetchImplementation(
      proxyUrl,
      buildProxyRequestInit(input, init, method, headers),
    );
  }) as typeof fetch;
}

export function createOpenRouterProxyHeaders(
  input: OpenRouterSignatureInput,
): Record<string, string> {
  return {
    [OPENROUTER_PROXY_HEADERS.keyId]: input.keyId,
    [OPENROUTER_PROXY_HEADERS.timestamp]: input.timestamp,
    [OPENROUTER_PROXY_HEADERS.nonce]: input.nonce,
    [OPENROUTER_PROXY_HEADERS.signature]: createOpenRouterProxySignature(input),
  };
}

export function createOpenRouterProxySignature(
  input: OpenRouterSignatureInput,
): string {
  const secret = decodeHmacSecret(input.encodedSecret);
  return createHmac("sha256", secret)
    .update(buildCanonicalRequest(input), "utf8")
    .digest("base64url");
}

function buildCanonicalRequest(input: OpenRouterSignatureInput): string {
  return [
    OPENROUTER_HMAC_VERSION,
    input.keyId,
    input.method.toUpperCase(),
    input.requestTarget,
    input.timestamp,
    input.nonce,
    createHash("sha256")
      .update(input.authorization.trim(), "utf8")
      .digest("base64url"),
  ].join("\n");
}

function assertValidHmacSecret(encodedSecret: string, providerLabel: string): void {
  try {
    decodeHmacSecret(encodedSecret);
  } catch {
    throw new ApplicationError(
      503,
      "LLM_SERVICE_NOT_CONFIGURED",
      `${providerLabel} transparent proxy HMAC secret must be a 32-byte Base64URL value.`,
    );
  }
}

function decodeHmacSecret(encodedSecret: string): Buffer {
  if (!/^[A-Za-z0-9_-]{43}$/.test(encodedSecret)) {
    throw new Error("invalid HMAC secret");
  }
  const secret = Buffer.from(encodedSecret, "base64url");
  if (secret.length !== 32 || secret.toString("base64url") !== encodedSecret) {
    throw new Error("invalid HMAC secret");
  }
  return secret;
}

function isOpenRouterUrl(url: URL): boolean {
  return url.protocol === "https:" && url.hostname.toLowerCase() === "openrouter.ai";
}

function buildProxyUrl(sourceUrl: URL, proxyBaseUrl: string): URL {
  const proxyUrl = new URL(proxyBaseUrl);
  const proxyPrefix = proxyUrl.pathname.replace(/\/+$/, "");
  const sourcePathAlreadyIncludesPrefix =
    proxyPrefix &&
    (sourceUrl.pathname === proxyPrefix ||
      sourceUrl.pathname.startsWith(`${proxyPrefix}/`));
  proxyUrl.pathname = sourcePathAlreadyIncludesPrefix
    ? sourceUrl.pathname
    : `${proxyPrefix}${sourceUrl.pathname}` || "/";
  proxyUrl.search = sourceUrl.search;
  return proxyUrl;
}

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return String(init?.method ?? (input instanceof Request ? input.method : "GET"))
    .toUpperCase();
}

function mergeHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return headers;
}

function buildProxyRequestInit(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  method: string,
  headers: Headers,
): RequestInit {
  const sourceRequest = input instanceof Request ? input : undefined;
  const body = init?.body ?? (
    sourceRequest && method !== "GET" && method !== "HEAD"
      ? sourceRequest.body
      : undefined
  );
  return {
    ...(sourceRequest
      ? {
          cache: sourceRequest.cache,
          credentials: sourceRequest.credentials,
          integrity: sourceRequest.integrity,
          keepalive: sourceRequest.keepalive,
          mode: sourceRequest.mode,
          redirect: sourceRequest.redirect,
          referrer: sourceRequest.referrer,
          referrerPolicy: sourceRequest.referrerPolicy,
          signal: sourceRequest.signal,
        }
      : {}),
    ...init,
    method,
    headers,
    ...(body === undefined ? {} : { body }),
    ...(sourceRequest?.body && typeof body === "object"
      ? ({ duplex: "half" } as RequestInit)
      : {}),
  };
}
