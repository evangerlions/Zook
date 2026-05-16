import assert from "node:assert/strict";
import test from "node:test";

import { readRequestBody } from "../../src/infrastructure/http/request-body.ts";

async function* toAsyncIterable(value: Buffer) {
  yield value;
}

test("readRequestBody parses application/json payloads", async () => {
  const body = await readRequestBody(
    toAsyncIterable(Buffer.from('{"hello":"world"}', "utf8")),
    "application/json; charset=utf-8",
  );

  assert.deepEqual(body, { hello: "world" });
});

test("readRequestBody keeps binary payloads as Buffer", async () => {
  const binary = Buffer.from([0x01, 0x02, 0x03, 0x7b, 0x7d]);
  const body = await readRequestBody(
    toAsyncIterable(binary),
    "application/octet-stream",
  );

  assert.ok(Buffer.isBuffer(body));
  assert.deepEqual(body, binary);
});

test("readRequestBody returns undefined for empty payloads", async () => {
  async function* empty() {}
  const body = await readRequestBody(empty(), "application/json");
  assert.equal(body, undefined);
});
