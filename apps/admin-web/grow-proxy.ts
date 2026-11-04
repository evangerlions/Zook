import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";

const HOP_HEADERS = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade"];

function withoutHopHeaders(headers: IncomingMessage["headers"]) {
  const clean = { ...headers };
  const nominated = String(headers.connection ?? "").split(",").map(value => value.trim().toLowerCase());
  for (const key of [...HOP_HEADERS, ...nominated]) delete clean[key];
  return clean;
}

/** The private upstream keeps /grow in the URL and handles prefix-aware auth. */
export function proxyGrow(request: IncomingMessage, response: ServerResponse, target?: string): void {
  response.setHeader("Cache-Control", "no-store");
  if (!target) {
    response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Grow is not enabled on this deployment.");
    return;
  }
  const incoming = new URL(request.url ?? "/", "http://admin.local");
  const upstream = new URL(target);
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  upstream.hash = "";
  const headers = withoutHopHeaders(request.headers);
  // Preserve the external origin for Grow's same-origin write validation.
  headers.host = request.headers.host;
  headers["x-forwarded-host"] = request.headers.host;
  headers["x-forwarded-proto"] = request.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  delete headers["x-forwarded-for"];
  delete headers["forwarded"];

  const upstreamRequest = (upstream.protocol === "https:" ? httpsRequest : httpRequest)(upstream, {
    method: request.method, headers,
  }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode ?? 502, withoutHopHeaders(upstreamResponse.headers));
    response.flushHeaders();
    upstreamResponse.on("error", () => response.destroy());
    // Stream downloads and AI events without buffering or automatic decompression.
    upstreamResponse.pipe(response);
  });
  upstreamRequest.on("error", () => {
    if (response.destroyed) return;
    if (response.headersSent) { response.destroy(); return; }
    response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Grow upstream is unavailable.");
  });
  upstreamRequest.setTimeout(300_000, () => upstreamRequest.destroy());
  request.on("aborted", () => upstreamRequest.destroy());
  request.on("error", () => upstreamRequest.destroy());
  response.on("close", () => upstreamRequest.destroy());
  request.pipe(upstreamRequest);
}
