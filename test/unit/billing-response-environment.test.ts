import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import test from "node:test";
import { bindBillingResponseEnvironment } from "../../src/modules/billing/billing-response-environment.ts";
import { billingEnvironment, inBillingEnvironment } from "../../src/modules/billing/billing-environment.ts";
import type { HttpResponse } from "../../src/shared/types.ts";

function response(streamBody?: AsyncIterable<string>): HttpResponse<null> {
  return { statusCode: 200, body: { code: "OK", message: "streaming", data: null, requestId: "test" }, streamBody };
}

test("non-stream responses remain unchanged", () => {
  const original = response();
  assert.equal(bindBillingResponseEnvironment(original, "sandbox"), original);
});

test("stream creation, asynchronous iteration and cancellation keep billing scope without capturing a transaction", async () => {
  const transaction = new AsyncLocalStorage<string>();
  const seen: string[] = [];
  const record = (stage: string) => seen.push(`${stage}:${billingEnvironment()}:${transaction.getStore()}`);
  const source: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      record("create");
      return (async function* () {
        try {
          record("next");
          await Promise.resolve();
          record("after-await");
          yield "chunk";
          assert.fail("consumer stopped before the next chunk");
        } finally {
          await Promise.resolve();
          record("finally");
        }
      })();
    },
  };
  const scoped = transaction.run("ended-dispatch-transaction", () =>
    bindBillingResponseEnvironment(response(source), "sandbox"));
  await transaction.run("consumer", async () => {
    for await (const chunk of scoped.streamBody!) {
      assert.equal(chunk, "chunk");
      assert.equal(billingEnvironment(), "production");
      break;
    }
  });
  assert.deepEqual(seen, ["create:sandbox:consumer", "next:sandbox:consumer", "after-await:sandbox:consumer", "finally:sandbox:consumer"]);
  assert.equal(billingEnvironment(), "production");
});

test("iterator throw, recovery and return execute in the stream's environment", async () => {
  const seen: string[] = [];
  const failure = new Error("consumer failure");
  const source = (async function* () {
    try {
      yield "first";
    } catch (error) {
      assert.equal(error, failure);
      await Promise.resolve();
      seen.push(`catch:${billingEnvironment()}`);
      yield "recovered";
    } finally {
      seen.push(`finally:${billingEnvironment()}`);
    }
  })();
  const iterator = bindBillingResponseEnvironment(response(source), "sandbox").streamBody![Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value, "first");
  assert.equal((await iterator.throw!(failure)).value, "recovered");
  assert.equal((await iterator.return!("closed")).value, "closed");
  assert.deepEqual(seen, ["catch:sandbox", "finally:sandbox"]);
  assert.equal(billingEnvironment(), "production");
});

test("concurrent iterators retain their own scopes and preserve next arguments and optional methods", async () => {
  const source: AsyncIterable<string> = { [Symbol.asyncIterator]: () => ({
    next: async (value?: unknown) => {
      await new Promise(resolve => setImmediate(resolve));
      return { value: `${billingEnvironment()}:${value}`, done: false };
    },
  }) };
  const sandbox = bindBillingResponseEnvironment(response(source), "sandbox").streamBody![Symbol.asyncIterator]();
  const production = bindBillingResponseEnvironment(response(source), "production").streamBody![Symbol.asyncIterator]();
  const result = await inBillingEnvironment("sandbox", () => Promise.all([production.next("p"), sandbox.next("s")]));
  assert.deepEqual(result.map(item => item.value), ["production:p", "sandbox:s"]);
  assert.equal(sandbox.return, undefined);
  assert.equal(sandbox.throw, undefined);
  assert.equal(billingEnvironment(), "production");
});
