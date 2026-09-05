import assert from "node:assert/strict";
import test from "node:test";
import { createBaiProxyAwareFetch } from "../../src/services/bai-proxy-fetch.ts";

test("B.AI proxy fetch is opt-in when no proxy environment is configured", () => {
  assert.equal(createBaiProxyAwareFetch({}), undefined);
});

test("B.AI proxy fetch recognizes standard HTTPS proxy environment variables", () => {
  assert.equal(
    typeof createBaiProxyAwareFetch({ HTTPS_PROXY: "http://127.0.0.1:7897" }),
    "function",
  );
});
