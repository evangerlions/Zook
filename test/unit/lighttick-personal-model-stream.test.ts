import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { streamPersonalModel } from "../../src/modules/lighttick/personal-model/personal-model.stream-transport.ts";

const url = "https://model.example/v1/chat/completions";
const body = '{"messages":[]}';
const signal = () => new AbortController().signal;
const PUBLIC = [{ address: "93.184.216.34", family: 4 }];

/** Captures the fake IncomingMessage so a test can drive the stream by hand. */
function capture(
  config: { status?: number; headers?: Record<string, string> } = {},
  addresses: { address: string; family: number }[] = PUBLIC,
) {
  let captured: any,
    sent = false;
  const io = {
    lookup: async () => addresses,
    request: (_u: any, _opts: any, callback: any) => {
      const req: any = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = () => {};
      req.end = () => {
        sent = true;
        const res: any = new EventEmitter();
        res.statusCode = config.status ?? 200;
        res.headers = config.headers ?? { "content-type": "text/event-stream" };
        res.destroy = () => {};
        captured = res;
        callback(res);
      };
      return req;
    },
  } as any;
  return {
    io,
    get res() {
      return captured;
    },
    get sent() {
      return sent;
    },
  };
}

test("a private or mixed-address endpoint is rejected before any request", async () => {
  const priv = capture({}, [{ address: "10.0.0.1", family: 4 }]);
  await assert.rejects(streamPersonalModel(url, { body }, signal(), priv.io), /MODEL_ADDRESS_FORBIDDEN/);
  assert.equal(priv.sent, false);

  const mixed = capture({}, [...PUBLIC, { address: "127.0.0.1", family: 4 }]);
  await assert.rejects(streamPersonalModel(url, { body }, signal(), mixed.io), /MODEL_ADDRESS_FORBIDDEN/);
  assert.equal(mixed.sent, false);
});

test("a redirect is rejected rather than followed", async () => {
  const f = capture({ status: 302, headers: { "content-type": "text/event-stream", location: "https://evil.example" } });
  await assert.rejects(streamPersonalModel(url, { body }, signal(), f.io), /MODEL_RESPONSE_UNSUPPORTED_HTTP_302/);
});

test("a non-streaming content type is rejected", async () => {
  const f = capture({ headers: { "content-type": "text/plain" } });
  await assert.rejects(streamPersonalModel(url, { body }, signal(), f.io), /MODEL_RESPONSE_UNSUPPORTED_HTTP_200/);
});

test("an oversized stream is aborted instead of buffered without bound", async () => {
  const f = capture();
  const response = await streamPersonalModel(url, { body }, signal(), f.io);
  const chunk = Buffer.alloc(1024 * 1024, 120);
  f.res.emit("data", chunk);
  f.res.emit("data", chunk);
  f.res.emit("data", chunk);
  await assert.rejects(
    (async () => {
      const reader = response.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) return;
      }
    })(),
    /MODEL_RESPONSE_TOO_LARGE/,
  );
});

test("an event stream body is readable incrementally, before the response ends", async () => {
  const f = capture();
  const response = await streamPersonalModel(url, { body }, signal(), f.io);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  f.res.emit("data", Buffer.from('data: {"a":1}\n\n'));
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.equal(decoder.decode(first.value), 'data: {"a":1}\n\n');

  f.res.emit("data", Buffer.from('data: {"b":2}\n\n'));
  const second = await reader.read();
  assert.equal(decoder.decode(second.value), 'data: {"b":2}\n\n');

  f.res.emit("end");
  assert.equal((await reader.read()).done, true);
});

test("a buffered JSON body is still exposed as a stream for the fallback path", async () => {
  const f = capture({ headers: { "content-type": "application/json" } });
  const response = await streamPersonalModel(url, { body }, signal(), f.io);
  assert.equal(response.headers.get("content-type"), "application/json");
  f.res.emit("data", Buffer.from('{"ok":true}'));
  f.res.emit("end");
  assert.deepEqual(await response.json(), { ok: true });
});
