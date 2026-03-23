import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface AdminServerOptions {
  proxyTarget?: string;
  brandName?: string;
  defaultAppId?: string;
  assetVersion?: string;
}

const STATIC_FILE_MAP = new Map<string, string>([
  ["/", "index.html"],
  ["/app.js", "app.js"],
  ["/styles.css", "styles.css"],
]);

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

const DEFAULT_PROXY_TARGET = "http://127.0.0.1:3100";
const DEFAULT_BRAND_NAME = "Zook Control Room";
const DEFAULT_PORT = 3110;
const INTERNAL_HEALTH_PATH = "/_admin/health";

function getStaticRoot(): string {
  return fileURLToPath(new URL("./", import.meta.url));
}

function toContentType(pathname: string): string {
  return CONTENT_TYPES[extname(pathname)] ?? "application/octet-stream";
}

function createRuntimeConfig(options: AdminServerOptions) {
  return {
    brandName: options.brandName ?? process.env.ADMIN_BRAND_NAME ?? DEFAULT_BRAND_NAME,
    defaultAppId: options.defaultAppId ?? process.env.ADMIN_DEFAULT_APP_ID ?? "",
    healthPath: "/api/health",
    analyticsUrl: process.env.ADMIN_ANALYTICS_URL ?? "https://analytics.youwoai.net",
    logsUrl: process.env.ADMIN_LOG_URL ?? "https://logs.youwoai.net/",
  };
}

function resolveAssetVersion(options: AdminServerOptions): string {
  const rawValue =
    options.assetVersion ??
    process.env.ADMIN_ASSET_VERSION ??
    process.env.APP_VERSION ??
    process.env.GIT_SHA ??
    "dev";

  return rawValue.trim() || "dev";
}

function createAssetFingerprint(assetVersion: string): string {
  return assetVersion.replace(/[^a-zA-Z0-9._-]/g, "-") || "dev";
}

function createVersionedAssetPath(pathname: string, assetVersion: string): string {
  const fingerprint = createAssetFingerprint(assetVersion);

  if (pathname === "/app.js") {
    return `/assets/app.${fingerprint}.js`;
  }

  if (pathname === "/styles.css") {
    return `/assets/styles.${fingerprint}.css`;
  }

  if (pathname === "/_admin/runtime-config.js") {
    return `/_admin/runtime-config.${fingerprint}.js`;
  }

  return pathname;
}

function resolveVersionedStaticAsset(pathname: string): string | null {
  const assetMatch = pathname.match(/^\/assets\/(app|styles)\.[a-zA-Z0-9._-]+\.(js|css)$/);
  if (assetMatch) {
    return assetMatch[1] === "app" ? "app.js" : "styles.css";
  }

  const runtimeMatch = pathname.match(/^\/_admin\/runtime-config\.[a-zA-Z0-9._-]+\.js$/);
  if (runtimeMatch) {
    return "_admin/runtime-config.js";
  }

  return null;
}

function sanitizeProxyHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();

  Object.entries(request.headers).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
      return;
    }

    headers.set(key, value);
  });

  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("host");
  headers.delete("transfer-encoding");
  headers.set("x-forwarded-host", request.headers.host ?? "");
  headers.set("x-forwarded-proto", "http");

  return headers;
}

async function proxyApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  proxyTarget: string,
): Promise<void> {
  const upstreamUrl = new URL(request.url ?? "/", proxyTarget);
  const method = request.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: sanitizeProxyHeaders(request),
    redirect: "manual",
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = request as never;
    init.duplex = "half";
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, init);
    response.statusCode = upstreamResponse.status;

    upstreamResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") {
        return;
      }
      response.setHeader(key, value);
    });

    const setCookies = upstreamResponse.headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0) {
      response.setHeader("Set-Cookie", setCookies);
    }

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
    response.end(buffer);
  } catch (error) {
    response.statusCode = 502;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify({
        code: "ADMIN_UPSTREAM_UNAVAILABLE",
        message: error instanceof Error ? error.message : "Admin upstream is unavailable.",
        data: null,
        requestId: "admin_proxy_error",
      }),
    );
  }
}

async function serveStaticFile(response: ServerResponse, pathname: string): Promise<void> {
  const filePath = new URL(`./${pathname}`, import.meta.url);
  const body = await readFile(filePath);
  response.statusCode = 200;
  response.setHeader("Content-Type", toContentType(pathname));
  if (pathname.endsWith(".js") || pathname.endsWith(".css")) {
    response.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  } else if (pathname.endsWith(".html")) {
    response.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  }
  response.end(body);
}

async function serveVersionedStaticFile(response: ServerResponse, pathname: string): Promise<void> {
  const filePath = new URL(`./${pathname}`, import.meta.url);
  const body = await readFile(filePath);
  response.statusCode = 200;
  response.setHeader("Content-Type", toContentType(pathname));
  response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  response.end(body);
}

async function serveIndex(response: ServerResponse, options: AdminServerOptions): Promise<void> {
  const assetVersion = resolveAssetVersion(options);
  const filePath = new URL("./index.html", import.meta.url);
  const template = await readFile(filePath, "utf8");
  const html = template
    .replaceAll("__ADMIN_STYLES_URL__", createVersionedAssetPath("/styles.css", assetVersion))
    .replaceAll("__ADMIN_RUNTIME_CONFIG_URL__", createVersionedAssetPath("/_admin/runtime-config.js", assetVersion))
    .replaceAll("__ADMIN_APP_SCRIPT_URL__", createVersionedAssetPath("/app.js", assetVersion));

  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  response.end(html);
}

function serveRuntimeConfig(response: ServerResponse, options: AdminServerOptions): void {
  const payload = JSON.stringify(createRuntimeConfig(options)).replace(/</g, "\\u003c");

  response.statusCode = 200;
  response.setHeader("Content-Type", "application/javascript; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  response.end(`window.__ADMIN_RUNTIME_CONFIG__ = ${payload};\n`);
}

function serveInternalHealth(response: ServerResponse): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(
    JSON.stringify({
      code: "OK",
      message: "success",
      data: {
        status: "ok",
      },
      requestId: "admin_health",
    }),
  );
}

function notFound(response: ServerResponse): void {
  response.statusCode = 404;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end("Not found.");
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: AdminServerOptions,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://admin.local");
  const pathname = url.pathname;

  if (pathname === INTERNAL_HEALTH_PATH) {
    serveInternalHealth(response);
    return;
  }

  if (pathname.startsWith("/api/")) {
    await proxyApiRequest(
      request,
      response,
      options.proxyTarget ?? process.env.ADMIN_API_PROXY_TARGET ?? DEFAULT_PROXY_TARGET,
    );
    return;
  }

  if (pathname === "/_admin/runtime-config.js") {
    serveRuntimeConfig(response, options);
    return;
  }

  const versionedStaticFile = resolveVersionedStaticAsset(pathname);
  if (versionedStaticFile === "_admin/runtime-config.js") {
    serveRuntimeConfig(response, options);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.statusCode = 405;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("Method not allowed.");
    return;
  }

  if (pathname === "/favicon.ico") {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (versionedStaticFile) {
    await serveVersionedStaticFile(response, versionedStaticFile);
    return;
  }

  const staticFile = STATIC_FILE_MAP.get(pathname);
  if (staticFile) {
    await serveStaticFile(response, staticFile);
    return;
  }

  if (pathname.startsWith("/_admin/")) {
    notFound(response);
    return;
  }

  await serveIndex(response, options);
}

export function createAdminServer(options: AdminServerOptions = {}): Server {
  return createServer((request, response) => {
    handleRequest(request, response, options).catch((error) => {
      response.statusCode = 500;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end(error instanceof Error ? error.message : "Admin server error.");
    });
  });
}

export function startAdminServer(options: AdminServerOptions = {}): Server {
  const server = createAdminServer(options);
  const port = Number(process.env.PORT ?? DEFAULT_PORT);

  server.listen(port, () => {
    const runtimeConfig = createRuntimeConfig(options);
    console.log(
      JSON.stringify(
        {
          level: "info",
          message: "admin-web started",
          port,
          proxyTarget:
            options.proxyTarget ?? process.env.ADMIN_API_PROXY_TARGET ?? DEFAULT_PROXY_TARGET,
          brandName: runtimeConfig.brandName,
          loginMode: "frontend-basic",
        },
        null,
        2,
      ),
    );
  });

  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  startAdminServer();
}
