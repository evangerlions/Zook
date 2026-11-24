import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { publicSourceAddress } from "../learning/learning-sources.ts";
import { modelUrl } from "./personal-model.service.ts";
export const PERSONAL_MODEL_MAX_REQUEST_BYTES = 256000;
export const PERSONAL_MODEL_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export interface PersonalModelEndpoint {
  url: URL;
  /** Loopback dev server: plain HTTP, no DNS pinning (local only). */
  localHttp: boolean;
  /** Resolved and validated address the socket must be pinned to. */
  pinned?: { address: string; family: number };
  body: string;
}
/**
 * Bounded, public-address-pinned HTTPS. Never follow redirects or log provider bodies.
 * Both the buffered and the streaming transport share this preamble so the security
 * checks cannot drift apart; each branch keeps its original check ordering.
 */
export async function resolvePersonalModelEndpoint(
  raw: string,
  init: RequestInit,
  signal: AbortSignal,
  io: { lookup: typeof lookup },
): Promise<PersonalModelEndpoint> {
  const u = new URL(raw);
  modelUrl(u.origin);
  if (u.username || u.password || u.search || u.hash)
    throw Error("MODEL_URL_FORBIDDEN");
  const host = u.hostname.replace(/^\[|\]$/g, ""),
    body = String(init.body ?? ""),
    assertBody = () => {
      if (Buffer.byteLength(body) > PERSONAL_MODEL_MAX_REQUEST_BYTES)
        throw Error("MODEL_REQUEST_TOO_LARGE");
    };
  // For local development, allow localhost connections
  if (process.env.APP_ENV === "local" && (host === "localhost" || host === "127.0.0.1" || host === "::1")) {
    assertBody();
    return { url: u, localHttp: true, body };
  }
  const addresses = await io.lookup(host, { all: true });
  signal.throwIfAborted();
  if (
    !addresses.length ||
    addresses.some((a) => !publicSourceAddress(a.address))
  )
    throw Error("MODEL_ADDRESS_FORBIDDEN");
  assertBody();
  return { url: u, localHttp: false, pinned: addresses[0], body };
}
/** Pin the socket to the address that passed the public-address check. */
export function pinnedLookup(pinned: { address: string; family: number }) {
  return (_host: string, opts: unknown, callback: (...args: any[]) => void) => {
    if (typeof opts === "object" && opts && (opts as { all?: boolean }).all)
      callback(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
}
/** Drain a fully buffered JSON response, rejecting anything unexpected. */
function collectBuffered(
  response: IncomingMessage,
  resolve: (value: Response) => void,
  reject: (reason: unknown) => void,
) {
  if (
    response.statusCode !== 200 ||
    !/^application\/json(?:;|$)/i.test(
      String(response.headers["content-type"] ?? ""),
    ) ||
    (response.headers["content-encoding"] &&
      response.headers["content-encoding"] !== "identity")
  ) {
    response.destroy();
    reject(Error("MODEL_RESPONSE_UNSUPPORTED_HTTP_" + response.statusCode));
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  response.on("data", (b: Buffer) => {
    size += b.length;
    if (size > PERSONAL_MODEL_MAX_RESPONSE_BYTES) {
      response.destroy(Error("MODEL_RESPONSE_TOO_LARGE"));
      return;
    }
    chunks.push(b);
  });
  response.on("error", reject);
  response.on("end", () => {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks),
      );
      resolve(
        new Response(text, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    } catch (error) {
      reject(error);
    }
  });
}
export async function fetchPersonalModel(
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
    const req = localHttp
      ? httpRequest(u, { method: "POST", signal, headers }, (response) =>
          collectBuffered(response, resolve, reject),
        )
      : io.request(
          u,
          {
            method: "POST",
            signal,
            lookup: pinnedLookup(pinned!),
            // Some compatible gateways reject requests without a User-Agent (405).
            headers: Object.fromEntries(new Headers({
              ...headers,
              "User-Agent": "Zook-LightTick/1.0",
            }).entries()),
          },
          (response) => collectBuffered(response, resolve, reject),
        );
    req.setTimeout(90000, () => req.destroy(Error("MODEL_TIMEOUT")));
    req.on("error", reject);
    req.end(body);
  });
}
