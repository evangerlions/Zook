import { createServer } from "node:http";
import { createApplication } from "./app.module.ts";

/**
 * readJsonBody keeps the transport adapter thin while still supporting the documented JSON APIs.
 */
async function readJsonBody(request: AsyncIterable<Buffer>): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString("utf8");
  }

  return body ? JSON.parse(body) : undefined;
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(",") : value,
    ]),
  );
}

const port = Number(process.env.PORT ?? 3100);
const runtime = createApplication({
  serviceName: "api",
  emitLogs: true,
});

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  try {
    const handled = await runtime.app.handle({
      method: request.method ?? "GET",
      path: url.pathname,
      headers: normalizeHeaders(request.headers),
      query: Object.fromEntries(url.searchParams.entries()),
      body: await readJsonBody(request),
      hostname: request.headers.host?.split(":")[0],
      trustedProxy: Boolean(request.headers["x-forwarded-for"]),
    });

    response.statusCode = handled.statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    Object.entries(handled.headers ?? {}).forEach(([key, value]) => {
      response.setHeader(key, value);
    });
    response.end(JSON.stringify(handled.body));
  } catch (error) {
    response.statusCode = 400;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify({
        code: "REQ_INVALID_BODY",
        message: error instanceof Error ? error.message : "Invalid JSON body.",
        data: null,
        requestId: "req_invalid_json",
      }),
    );
  }
});

server.listen(port, () => {
  runtime.logger.info("api started", {
    path: "bootstrap",
    statusCode: 200,
  });
});
