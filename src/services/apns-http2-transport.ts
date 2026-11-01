import { connect, type ClientHttp2Session, type ClientHttp2Stream, type IncomingHttpHeaders } from "node:http2";

/** Sends APNs requests over HTTP/2 with request-local state and bounded cleanup. */
export function sendApnsRequest(url: string, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const session = connect(target.origin);
    let settled = false;
    const finish = (error?: Error, response?: Response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { session.destroy(); reject(error); }
      else { session.close(); resolve(response!); }
    };
    const timer = setTimeout(() => finish(new Error("APNs HTTP/2 request timed out")), timeoutMs);
    session.on("error", error => finish(error));
    session.on("close", () => finish(new Error("APNs HTTP/2 session closed before response")));
    send(session, target, init, finish);
  });
}

function send(session: ClientHttp2Session, target: URL, init: RequestInit,
  finish: (error?: Error, response?: Response) => void): void {
  try {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const stream = session.request({ ":method": init.method ?? "POST", ":path": target.pathname + target.search, ...headers });
    readResponse(stream, finish);
    stream.end(init.body);
  } catch (error) { finish(error instanceof Error ? error : new Error("APNs request failed")); }
}

function readResponse(stream: ClientHttp2Stream, finish: (error?: Error, response?: Response) => void): void {
  let headers: IncomingHttpHeaders = {};
  const chunks: Buffer[] = [];
  let size = 0;
  stream.on("response", value => { headers = value; });
  stream.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > 65_536) { finish(new Error("APNs response exceeded size limit")); return; }
    chunks.push(chunk);
  });
  stream.on("error", error => finish(error));
  stream.on("aborted", () => finish(new Error("APNs HTTP/2 stream aborted")));
  stream.on("end", () => {
    const status = Number(headers[":status"]);
    if (!Number.isInteger(status) || status < 200 || status > 599) {
      finish(new Error("Invalid APNs HTTP/2 response status")); return;
    }
    finish(undefined, new Response(chunks.length ? Buffer.concat(chunks) : null, { status }));
  });
}
