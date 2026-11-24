import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { request as httpRequest, type IncomingMessage } from "node:http";
import {
  PERSONAL_MODEL_MAX_RESPONSE_BYTES,
  pinnedLookup,
  resolvePersonalModelEndpoint,
} from "./personal-model.transport.ts";
/**
 * Same bounded, address-pinned HTTPS as `fetchPersonalModel`, but the body is
 * exposed as a live stream so SSE events can be consumed while the model is
 * still generating. Accepts `text/event-stream` as well as `application/json`:
 * some gateways ignore `stream: true` and answer with one buffered JSON body,
 * which the caller then parses through the ordinary completion path.
 */
function streamedResponse(response: IncomingMessage): Response {
  const type = String(response.headers["content-type"] ?? "");
  if (
    response.statusCode !== 200 ||
    !/^(text\/event-stream|application\/json)(?:;|$)/i.test(type) ||
    (response.headers["content-encoding"] &&
      response.headers["content-encoding"] !== "identity")
  ) {
    response.destroy();
    throw Error("MODEL_RESPONSE_UNSUPPORTED_HTTP_" + response.statusCode);
  }
  let settled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let size = 0;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        controller.error(error);
      };
      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > PERSONAL_MODEL_MAX_RESPONSE_BYTES) {
          fail(Error("MODEL_RESPONSE_TOO_LARGE"));
          response.destroy(Error("MODEL_RESPONSE_TOO_LARGE"));
          return;
        }
        controller.enqueue(new Uint8Array(chunk));
      });
      response.on("error", fail);
      response.on("end", () => {
        if (settled) return;
        settled = true;
        controller.close();
      });
    },
    cancel() {
      response.destroy();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": type } });
}
export async function streamPersonalModel(
  raw: string,
  init: RequestInit,
  signal: AbortSignal,
  io = { lookup, request },
): Promise<Response> {
  const { url: u, localHttp, pinned, body } = await resolvePersonalModelEndpoint(
    raw,
    init,
    signal,
    io,
  );
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  return new Promise((resolve, reject) => {
    const onResponse = (response: IncomingMessage) => {
      try {
        resolve(streamedResponse(response));
      } catch (error) {
        reject(error);
      }
    };
    const req = localHttp
      ? httpRequest(u, { method: "POST", signal, headers }, onResponse)
      : io.request(
          u,
          {
            method: "POST",
            signal,
            lookup: pinnedLookup(pinned!),
            headers: Object.fromEntries(new Headers({
              ...headers,
              "User-Agent": "Zook-LightTick/1.0",
            }).entries()),
          },
          onResponse,
        );
    req.setTimeout(90000, () => req.destroy(Error("MODEL_TIMEOUT")));
    req.on("error", reject);
    req.end(body);
  });
}
