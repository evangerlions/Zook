import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { request as httpRequest } from "node:http";
import { publicSourceAddress } from "../learning/learning-sources.ts";
import { modelUrl } from "./personal-model.service.ts";
/** Bounded, public-address-pinned HTTPS. Never follow redirects or log provider bodies. */
export async function fetchPersonalModel(
  raw: string,
  init: RequestInit,
  signal: AbortSignal,
  io = { lookup, request },
): Promise<Response> {
  const u = new URL(raw);
  modelUrl(u.origin);
  if (u.username || u.password || u.search || u.hash)
    throw Error("MODEL_URL_FORBIDDEN");
  const host = u.hostname.replace(/^\[|\]$/g, ""),
    isLocal = process.env.APP_ENV === "local";
  // For local development, allow localhost connections
  if (isLocal && (host === "localhost" || host === "127.0.0.1" || host === "::1")) {
    // Use HTTP for local connections
    const body = String(init.body ?? "");
    if (Buffer.byteLength(body) > 256000) throw Error("MODEL_REQUEST_TOO_LARGE");
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        u,
        {
          method: "POST",
          signal,
          headers: Object.fromEntries(new Headers(init.headers).entries()),
        },
        (response) => {
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
            if (size > 2 * 1024 * 1024) {
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
        },
      );
      req.setTimeout(30000, () => req.destroy(Error("MODEL_TIMEOUT")));
      req.on("error", reject);
      req.end(body);
    });
  }
  const addresses = await io.lookup(host, { all: true });
  signal.throwIfAborted();
  if (
    !addresses.length ||
    addresses.some((a) => !publicSourceAddress(a.address))
  )
    throw Error("MODEL_ADDRESS_FORBIDDEN");
  const pinned = addresses[0],
    body = String(init.body ?? "");
  if (Buffer.byteLength(body) > 256000) throw Error("MODEL_REQUEST_TOO_LARGE");
  return new Promise((resolve, reject) => {
    const req = io.request(
      u,
      {
        method: "POST",
        signal,
        lookup: (_host, opts, callback) => {
          if (typeof opts === "object" && opts.all)
            (callback as any)(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
        // Some compatible gateways reject requests without a User-Agent (405).
        headers: Object.fromEntries(new Headers({
          ...Object.fromEntries(new Headers(init.headers).entries()),
          "User-Agent": "Zook-LightTick/1.0",
        }).entries()),
      },
      (response) => {
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
          if (size > 2 * 1024 * 1024) {
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
      },
    );
    req.setTimeout(15000, () => req.destroy(Error("MODEL_TIMEOUT")));
    req.on("error", reject);
    req.end(body);
  });
}
