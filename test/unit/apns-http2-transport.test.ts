import assert from "node:assert/strict";
import { createServer, constants, type Http2Server } from "node:http2";
import { once } from "node:events";
import { createServer as createTcpServer } from "node:net";
import test from "node:test";
import { sendApnsRequest } from "../../src/services/apns-http2-transport.ts";

async function listen(server: Http2Server): Promise<string> {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("APNs transport uses actual HTTP/2 and preserves request headers, body and error response", async () => {
  const server = createServer();
  server.on("stream", (stream, headers) => {
    assert.equal(headers[":method"], "POST"); assert.equal(headers[":path"], "/3/device/test");
    assert.equal(headers["apns-topic"], "com.hulusleep.app"); assert.equal(headers.authorization, "bearer test");
    let body = ""; stream.on("data", chunk => { body += chunk; });
    stream.on("end", () => {
      assert.deepEqual(JSON.parse(body), { aps: { alert: "QA" } });
      stream.respond({ ":status": 400 }); stream.end('{"reason":"BadDeviceToken"}');
    });
  });
  const origin = await listen(server);
  try {
    const response = await sendApnsRequest(origin + "/3/device/test", { method: "POST",
      headers: { "apns-topic": "com.hulusleep.app", authorization: "bearer test" }, body: '{"aps":{"alert":"QA"}}' });
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { reason: "BadDeviceToken" });
  } finally { server.close(); }
});

test("APNs concurrent responses remain request-local", async () => {
  const server = createServer();
  server.on("stream", (stream, headers) => {
    stream.on("data", () => {}); stream.on("end", () => {
      setTimeout(() => { stream.respond({ ":status": 200 }); stream.end(String(headers[":path"])); },
        String(headers[":path"]).endsWith("first") ? 30 : 0);
    });
  });
  const origin = await listen(server);
  try {
    const responses = await Promise.all(["first", "second"].map(id => sendApnsRequest(origin + "/" + id, { body: "{}" })));
    assert.deepEqual(await Promise.all(responses.map(r => r.text())), ["/first", "/second"]);
  } finally { server.close(); }
});

test("APNs request deadline rejects and closes an unresponsive HTTP/2 session", async () => {
  const server = createServer(); server.on("stream", stream => { stream.on("data", () => {}); });
  const origin = await listen(server);
  try { await assert.rejects(sendApnsRequest(origin + "/timeout", { body: "{}" }, 50), /timed out/); }
  finally { server.close(); }
});

test("APNs deadline includes TLS handshake and destroys the stalled socket", async () => {
  const server = createTcpServer();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const connected = once(server, "connection", { signal: AbortSignal.timeout(2_000) });
  const rejected = assert.rejects(sendApnsRequest(`https://127.0.0.1:${address.port}/timeout`, { body: "{}" }, 100), /timed out/);
  const [socket] = await connected;
  // Drain the ClientHello but never respond to it.
  socket.resume();
  const closed = once(socket, "close", { signal: AbortSignal.timeout(2_000) });
  try {
    await rejected;
    await closed;
  } finally { socket.destroy(); server.close(); }
});

test("APNs session closing before response rejects without waiting for the deadline", async () => {
  const server = createServer();
  server.on("stream", stream => {
    stream.on("error", () => {}); stream.on("data", () => {});
    stream.on("end", () => stream.session.destroy());
  });
  const origin = await listen(server);
  try {
    await assert.rejects(sendApnsRequest(origin + "/closed", { body: "{}" }, 1_000),
      /Invalid APNs HTTP\/2 response status|session closed|stream aborted/);
  } finally { server.close(); }
});

test("APNs stream reset rejects rather than hanging or reporting success", async () => {
  const server = createServer();
  server.on("stream", stream => {
    stream.on("error", () => {}); stream.on("data", () => {});
    stream.on("end", () => stream.close(constants.NGHTTP2_INTERNAL_ERROR));
  });
  const origin = await listen(server);
  try { await assert.rejects(sendApnsRequest(origin + "/reset", { body: "{}" })); }
  finally { server.close(); }
});

test("APNs empty success and oversized response are handled without leaking sessions", async () => {
  const server = createServer();
  server.on("stream", (stream, headers) => {
    stream.on("error", () => {}); stream.on("data", () => {}); stream.on("end", () => {
      stream.respond({ ":status": 200 });
      stream.end(headers[":path"] === "/large" ? "x".repeat(70_000) : undefined);
    });
  });
  const origin = await listen(server);
  try {
    const response = await sendApnsRequest(origin + "/ok", { body: "{}" });
    assert.equal(response.status, 200); assert.equal(await response.text(), "");
    await assert.rejects(sendApnsRequest(origin + "/large", { body: "{}" }), /size limit/);
  } finally { server.close(); }
});
