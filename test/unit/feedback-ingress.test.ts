import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { test } from "node:test";

import { createAdminServer } from "../../apps/admin-web/server.ts";
import { FeedbackIngress, FeedbackIngressError, feedbackIngressPolicy, holdFeedbackSlotThroughResponse, withFeedbackBodyDeadline } from "../../src/infrastructure/http/feedback-ingress.ts";

test("feedback ingress rejects excessive bodies and releases concurrent slots", () => {
  const ingress = new FeedbackIngress();
  const userUpload = feedbackIngressPolicy("POST", "/api/v1/ai_novel/feedback/a/messages")!;
  const adminUpload = feedbackIngressPolicy("POST", "/api/v1/admin/apps/ai_novel/feedback/a/messages")!;
  const incoming = { headers: {} } as IncomingMessage;
  const large = { headers: { "content-length": String(userUpload.maxBytes + 1) } } as IncomingMessage;
  const statusIs = (status: number) => (error: unknown) => error instanceof FeedbackIngressError && error.status === status;

  assert.throws(() => ingress.acquire(large, userUpload), statusIs(413));
  const slots = Array.from({ length: 4 }, () => ingress.acquire(incoming, userUpload));
  assert.throws(() => ingress.acquire(incoming, userUpload), statusIs(429));
  ingress.acquire(incoming, adminUpload)();
  ingress.acquire(incoming, feedbackIngressPolicy("GET", "/api/v1/ai_novel/feedback/a/attachments/b")!)();
  slots.pop()!();
  ingress.acquire(incoming, userUpload)();
  slots.forEach((release) => release());
  assert.equal(feedbackIngressPolicy("GET", "/api/v1/ai_novel/models"), undefined);
});

test("a stalled feedback upload expires", async () => {
  await assert.rejects(withFeedbackBodyDeadline(new Promise(() => {}), 1), { status: 408 });
  assert.equal(await withFeedbackBodyDeadline(Promise.resolve("ready")), "ready");
});

test("a queued image response holds admission until the socket finishes or closes", () => {
  const response = new EventEmitter();
  let released = 0;
  const handlerFinished = holdFeedbackSlotThroughResponse(response as unknown as ServerResponse, () => { released += 1; });
  handlerFinished();
  assert.equal(released, 0);
  response.emit("finish");
  response.emit("close");
  assert.equal(released, 1);
});

test("the Admin proxy stops a chunked oversized feedback request before calling the API", async (t) => {
  let upstreamRequests = 0;
  const upstream = createServer((_request, response) => {
    upstreamRequests += 1;
    response.end("ok");
  }).listen(0, "127.0.0.1");
  t.after(() => upstream.close());
  await once(upstream, "listening");
  const proxy = createAdminServer({ proxyTarget: origin(upstream) }).listen(0, "127.0.0.1");
  t.after(() => proxy.close());
  await once(proxy, "listening");
  const path = "/api/v1/admin/apps/ai_novel/feedback/example/status";

  const status = await new Promise<number | undefined>((resolve, reject) => {
    const upload = request(origin(proxy) + path, { method: "PATCH", headers: { "transfer-encoding": "chunked" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    upload.on("error", reject);
    upload.write(Buffer.alloc(6 * 1024));
    upload.end(Buffer.alloc(4 * 1024));
  });
  assert.equal(status, 413);
  assert.equal(upstreamRequests, 0);

  const result = await fetch(origin(proxy) + path, { method: "PATCH", body: "{}" });
  assert.equal(await result.text(), "ok");
  assert.equal(upstreamRequests, 1);
});

function origin(server: ReturnType<typeof createServer>): string {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
