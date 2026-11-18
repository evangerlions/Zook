import test from "node:test";
import assert from "node:assert/strict";
import {
  createProgressCoalescer,
  streamProgress,
} from "../../src/modules/lighttick/learning/learning-stream-progress.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";

const document = routeFixture().document;

test("streamProgress never throws on any prefix and counts monotonically", () => {
  const text = JSON.stringify(document);
  let previous = 0;
  for (let end = 0; end <= text.length; end++) {
    const prefix = text.slice(0, end);
    const value = streamProgress(prefix);
    assert.equal(value.received_chars, end);
    assert.ok(
      value.lesson_count_so_far >= previous,
      `count regressed at ${end}: ${value.lesson_count_so_far} < ${previous}`,
    );
    previous = value.lesson_count_so_far;
    // Two lessons exist, so a complete object can only appear once the full
    // document has arrived; the first lesson completes earlier.
    assert.ok(value.lesson_count_so_far <= 2);
  }
  assert.equal(streamProgress(text).lesson_count_so_far, 2);
});

test("streamProgress counts the first lesson before the document is complete", () => {
  const text = JSON.stringify(document);
  const firstLessonEnd = text.indexOf('"kind":"review"');
  assert.ok(firstLessonEnd > 0);
  const partial = text.slice(0, firstLessonEnd);
  assert.equal(streamProgress(partial).lesson_count_so_far, 1);
  assert.equal(streamProgress(partial).received_chars, partial.length);
});

test("streamProgress is not confused by braces, quotes and escapes in strings", () => {
  const tricky = JSON.stringify({
    prerequisites: "lessons",
    stages: [{ title: 'a "}" and { b', goal: "x" }],
    lessons: [
      { number: 1, topic: 'quote " } ] { \\ end', goal: "g", exercise: "e", assessment: "a", minutes: 5, stage: 1, kind: "lesson", requires: [] },
      { number: 2, topic: "unicode \u007d brace", goal: "g", exercise: "e", assessment: "a", minutes: 5, stage: 1, kind: "review", requires: [1] },
    ],
  });
  assert.equal(streamProgress(tricky).lesson_count_so_far, 2);
  // A value string spelled "lessons" must not hijack the array lookup.
  const decoy = JSON.stringify({
    prerequisites: "lessons",
    stages: [{ title: "s", goal: "g" }],
    lessons: [{ number: 1, topic: "t", goal: "g", exercise: "e", assessment: "a", minutes: 5, stage: 1, kind: "review", requires: [] }],
  });
  assert.equal(streamProgress(decoy).lesson_count_so_far, 1);
});

test("streamProgress reports zero for structurally empty prefixes", () => {
  for (const prefix of ["", "{", '{"lessons"', '{"lessons":', '{"lessons":[', '{"lessons":[{'])
    assert.equal(streamProgress(prefix).lesson_count_so_far, 0, prefix);
  assert.equal(streamProgress('{"lessons":[]}').lesson_count_so_far, 0);
});

test("streamProgress tolerates a truncated lesson and truncated escapes", () => {
  assert.equal(streamProgress('{"lessons":[{"topic":"abc').lesson_count_so_far, 0);
  assert.equal(streamProgress('{"lessons":[{"topic":"abc\\').lesson_count_so_far, 0);
  assert.equal(streamProgress('{"lessons":[{"topic":"abc\\"').lesson_count_so_far, 0);
});

function harness(flushMs = 800) {
  const writes: { received_chars: number; lesson_count_so_far: number }[] = [];
  let clock = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const coalescer = createProgressCoalescer({
    flushMs,
    now: () => clock,
    setTimer: (fn, ms) => setTimeout(fn, 0) as unknown,
    clearTimer: (h) => clearTimeout(h as any),
    write: async (value) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      writes.push({ ...value });
      await Promise.resolve();
      inFlight--;
    },
  });
  return {
    coalescer,
    writes,
    advance: (ms: number) => {
      clock += ms;
    },
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

test("coalescer collapses a burst of deltas into a single write", async () => {
  const h = harness();
  const text = JSON.stringify(document);
  // Deltas inside the prerequisites/stages region: no lesson completes yet.
  for (let end = 1; end <= 40; end++) h.coalescer.text(text.slice(0, end));
  await h.coalescer.close();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].received_chars, 40);
});

test("coalescer writes immediately when the lesson count advances", async () => {
  const h = harness();
  const text = JSON.stringify(document);
  h.coalescer.text(text.slice(0, 40));
  const firstLessonEnd = text.indexOf('"kind":"review"');
  h.coalescer.text(text.slice(0, firstLessonEnd));
  await h.coalescer.close();
  assert.ok(
    h.writes.some((w) => w.lesson_count_so_far === 1),
    "expected a forced write once the first lesson completed",
  );
});

test("coalescer keeps at most one write in flight and flushes on close", async () => {
  const h = harness();
  const text = JSON.stringify(document);
  h.coalescer.text(text.slice(0, 10));
  h.coalescer.text(text.slice(0, 20));
  h.coalescer.text(text.slice(0, 30));
  await h.coalescer.close();
  assert.equal(h.maxInFlight, 1);
  assert.equal(h.writes.at(-1)!.received_chars, 30);
  // Writing after close must be ignored rather than resurrect the timer.
  h.coalescer.text(text);
  await h.coalescer.close();
  assert.equal(h.writes.at(-1)!.received_chars, 30);
});

test("coalescer throttles writes that are separated by the flush window", async () => {
  const h = harness(800);
  const text = JSON.stringify(document);
  h.coalescer.text(text.slice(0, 10));
  await h.coalescer.close();
  const afterFirst = h.writes.length;
  const h2 = harness(800);
  h2.coalescer.text(text.slice(0, 10));
  h2.advance(900);
  h2.coalescer.text(text.slice(0, 20));
  await h2.coalescer.close();
  assert.ok(h2.writes.length >= afterFirst);
  assert.equal(h2.writes.at(-1)!.received_chars, 20);
});
