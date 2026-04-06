import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface AdminServerOptions {
  proxyTarget?: string;
  brandName?: string;
  defaultAppId?: string;
  staticRoot?: string;
  assetVersion?: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const DEFAULT_PROXY_TARGET = "http://127.0.0.1:3100";
const DEFAULT_BRAND_NAME = "Zook Control Room";
const DEFAULT_PORT = 3110;
const DEFAULT_STATIC_ROOT = fileURLToPath(new URL("./build/client", import.meta.url));
const INTERNAL_HEALTH_PATH = "/_admin/health";
const RUNTIME_CONFIG_PATH = "/_admin/runtime-config.js";
const ROOT_PACKAGE_VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
).version as string;

function createRuntimeConfig(options: AdminServerOptions) {
  return {
    brandName: options.brandName ?? process.env.ADMIN_BRAND_NAME ?? DEFAULT_BRAND_NAME,
    defaultAppId: options.defaultAppId ?? process.env.ADMIN_DEFAULT_APP_ID ?? "",
    version: process.env.APP_VERSION ?? ROOT_PACKAGE_VERSION,
    healthPath: "/api/health",
    analyticsUrl: process.env.ADMIN_ANALYTICS_URL ?? "https://analytics.youwoai.net",
    logsUrl: process.env.ADMIN_LOG_URL ?? "https://logs.youwoai.net/",
  };
}

function getStaticRoot(options: AdminServerOptions): string {
  return options.staticRoot ?? process.env.ADMIN_STATIC_ROOT ?? DEFAULT_STATIC_ROOT;
}

function toContentType(pathname: string): string {
  return CONTENT_TYPES[extname(pathname)] ?? "application/octet-stream";
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

async function statIfExists(pathname: string) {
  try {
    return await stat(pathname);
  } catch {
    return null;
  }
}

function resolveStaticPath(staticRoot: string, pathname: string): string | null {
  const normalizedPath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const resolvedPath = resolve(join(staticRoot, normalizedPath.replace(/^[/\\]+/, "")));
  const resolvedRoot = resolve(staticRoot);

  if (!resolvedPath.startsWith(resolvedRoot)) {
    return null;
  }

  return resolvedPath;
}

async function serveFile(response: ServerResponse, pathname: string, cacheControl: string): Promise<void> {
  response.statusCode = 200;
  response.setHeader("Content-Type", toContentType(pathname));
  response.setHeader("Cache-Control", cacheControl);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(pathname);
    stream.on("error", rejectPromise);
    stream.on("end", () => resolvePromise());
    stream.pipe(response);
  });
}

function serveRuntimeConfig(response: ServerResponse, options: AdminServerOptions): void {
  const payload = JSON.stringify(createRuntimeConfig(options)).replace(/</g, "\\u003c");
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/javascript; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
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

function serviceUnavailable(response: ServerResponse): void {
  response.statusCode = 503;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end("Admin web build is missing. Run `npm run admin:install` and `npm run admin:build` first.");
}

async function serveIndex(response: ServerResponse, staticRoot: string): Promise<void> {
  const indexPath = join(staticRoot, "index.html");
  const indexStat = await statIfExists(indexPath);
  if (!indexStat?.isFile()) {
    serviceUnavailable(response);
    return;
  }

  await serveFile(response, indexPath, "no-store");
}

async function handleStaticRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  options: AdminServerOptions,
): Promise<void> {
  if (pathname === RUNTIME_CONFIG_PATH) {
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
    const faviconPath = resolveStaticPath(getStaticRoot(options), pathname);
    if (faviconPath) {
      const faviconStat = await statIfExists(faviconPath);
      if (faviconStat?.isFile()) {
        await serveFile(response, faviconPath, "public, max-age=3600");
        return;
      }
    }

    response.statusCode = 204;
    response.end();
    return;
  }

  if (pathname.startsWith("/_admin/")) {
    notFound(response);
    return;
  }

  const staticRoot = getStaticRoot(options);
  const resolvedPath = resolveStaticPath(staticRoot, pathname);
  if (!resolvedPath) {
    notFound(response);
    return;
  }

  const fileStat = await statIfExists(resolvedPath);
  if (fileStat?.isFile()) {
    const cacheControl = pathname.includes("/assets/") || /\.[a-z0-9]{8,}\./i.test(pathname)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600";
    await serveFile(response, resolvedPath, cacheControl);
    return;
  }

  if (extname(pathname)) {
    notFound(response);
    return;
  }

  await serveIndex(response, staticRoot);
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

  await handleStaticRequest(request, response, pathname, options);
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
          proxyTarget: options.proxyTarget ?? process.env.ADMIN_API_PROXY_TARGET ?? DEFAULT_PROXY_TARGET,
          staticRoot: getStaticRoot(options),
          brandName: runtimeConfig.brandName,
          loginMode: "session-cookie",
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
