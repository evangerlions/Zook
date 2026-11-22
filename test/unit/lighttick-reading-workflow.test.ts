import test from "node:test";
import assert from "node:assert/strict";
import {
  parseReadingFeed,
  assertPublicAddress,
} from "../../src/modules/lighttick/reading/reading-feed.ts";
import { ReadingWorkflowService } from "../../src/modules/lighttick/reading/reading-workflow.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
const owner = { appId: "lighttick", userId: "user_alice" };
const feed =
  "<rss><channel><item><title><![CDATA[A & B]]></title><link>https://example.com/a?utm_source=x</link><description>&lt;p&gt;Summary&lt;/p&gt;</description></item><item><title>Duplicate</title><link>https://example.com/a</link></item></channel></rss>";
test("RSS/Atom candidates are bounded, deduplicated and never labelled full text", () => {
  const items = parseReadingFeed(feed, "https://example.com/feed");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "A & B");
  assert.equal(items[0].summary, "Summary");
  assert.equal(
    parseReadingFeed(
      '<feed><entry><title>Atom</title><link rel="alternate" href="/article"/></entry></feed>',
      "https://example.com/feed",
    )[0].url,
    "https://example.com/article",
  );
  assert.throws(() =>
    parseReadingFeed("<!DOCTYPE x><rss/>", "https://example.com/feed"),
  );
});
test("external feed boundary rejects private, mapped, multicast and reserved addresses", () => {
  for (const value of [
    "127.0.0.1",
    "10.2.3.4",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "224.0.0.1",
    "0.0.0.0",
    "2001:db8::1",
  ])
    assert.throws(() => assertPublicAddress(value), value);
  assert.doesNotThrow(() => assertPublicAddress("8.8.8.8"));
  assert.doesNotThrow(() => assertPublicAddress("2606:4700:4700::1111"));
});
test("sources and collection history are owner scoped, retries deduplicate and partial failures are visible", async () => {
  const repo = new InMemoryLightTickRepository();
  let calls = 0;
  const service = new ReadingWorkflowService(repo, async () => {
    calls++;
    return feed;
  });
  const source = await service.addSource(owner, {
    name: "Example",
    url: "https://example.com/feed",
    language: "en",
    topics: ["growth"],
  });
  const request = {
    request_key: "reading-request-123",
    source_ids: [source.id],
    q: "",
    language: "all",
  };
  const result = await service.collect(owner, request);
  assert.equal(result.candidates.length, 1);
  assert.equal(calls, 1);
  assert.deepEqual(await service.collect(owner, request), result);
  assert.equal(calls, 1);
  assert.equal(
    (await service.setup({ ...owner, userId: "user_bob" })).sources.some(
      (s) => s.id === source.id,
    ),
    false,
  );
  await assert.rejects(
    () => service.collect(owner, { ...request, q: "changed" }),
    { statusCode: 409 },
  );
  const failed = await new ReadingWorkflowService(repo, async () => {
    throw Error("secret-provider-body");
  }).collect(owner, { ...request, request_key: "reading-request-456" });
  assert.equal(failed.status, "failed");
  assert.equal(failed.sources[0].error, "来源读取失败，请稍后重试。");
  assert.equal(JSON.stringify(failed).includes("secret-provider-body"), false);
});

test("feed parser rejects malformed XML, DTDs, unsupported roots, unsafe links and oversized entries", () => {
  for (const raw of [
    "<rss><item></rss>",
    "<rss><item>",
    "<html/>",
    "<feed>&unknown;</feed>",
  ])
    assert.throws(() => parseReadingFeed(raw, "https://example.com/feed"));
  const entries = [
    "javascript:alert(1)",
    "https://user:password@example.com/a",
    "https://127.0.0.1/private",
    "https://example.com/" + "x".repeat(1600),
  ]
    .map((url) => `<item><title>Bad</title><link>${url}</link></item>`)
    .join("");
  assert.equal(
    parseReadingFeed(`<rss>${entries}</rss>`, "https://example.com/feed")
      .length,
    0,
  );
});
