import assert from "node:assert/strict";
import test from "node:test";
import { ValidationPipe } from "../../src/core/pipes/validation.pipe.ts";

const pipe = new ValidationPipe();

// --- asObject ---

test("ValidationPipe.asObject returns empty object for undefined", () => {
  assert.deepEqual(pipe.asObject(undefined), {});
});

test("ValidationPipe.asObject passes through plain objects", () => {
  const input = { name: "test", count: 42 };
  assert.deepEqual(pipe.asObject(input), input);
});

test("ValidationPipe.asObject rejects null", () => {
  assert.throws(
    () => pipe.asObject(null),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

test("ValidationPipe.asObject rejects arrays", () => {
  assert.throws(
    () => pipe.asObject([1, 2, 3]),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

test("ValidationPipe.asObject rejects primitives", () => {
  assert.throws(
    () => pipe.asObject("string"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

// --- requireString ---

test("ValidationPipe.requireString returns trimmed string", () => {
  assert.equal(pipe.requireString({ name: "  hello  " }, "name"), "hello");
});

test("ValidationPipe.requireString rejects undefined", () => {
  assert.throws(
    () => pipe.requireString({}, "name"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

test("ValidationPipe.requireString rejects empty string", () => {
  assert.throws(
    () => pipe.requireString({ name: "" }, "name"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

test("ValidationPipe.requireString rejects whitespace-only string", () => {
  assert.throws(
    () => pipe.requireString({ name: "   " }, "name"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

test("ValidationPipe.requireString rejects non-string values", () => {
  assert.throws(
    () => pipe.requireString({ name: 123 }, "name"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

// --- optionalString ---

test("ValidationPipe.optionalString returns trimmed string when present", () => {
  assert.equal(pipe.optionalString({ desc: "  hi  " }, "desc"), "hi");
});

test("ValidationPipe.optionalString returns undefined for missing key", () => {
  assert.equal(pipe.optionalString({}, "desc"), undefined);
});

test("ValidationPipe.optionalString returns undefined for null", () => {
  assert.equal(pipe.optionalString({ desc: null }, "desc"), undefined);
});

test("ValidationPipe.optionalString returns undefined for empty string", () => {
  assert.equal(pipe.optionalString({ desc: "" }, "desc"), undefined);
});

test("ValidationPipe.optionalString rejects non-string value", () => {
  assert.throws(
    () => pipe.optionalString({ desc: 42 }, "desc"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

// --- requireNumber ---

test("ValidationPipe.requireNumber returns number", () => {
  assert.equal(pipe.requireNumber({ count: 42 }, "count"), 42);
});

test("ValidationPipe.requireNumber rejects NaN", () => {
  assert.throws(
    () => pipe.requireNumber({ count: NaN }, "count"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

test("ValidationPipe.requireNumber rejects string that looks like a number", () => {
  assert.throws(
    () => pipe.requireNumber({ count: "42" }, "count"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

// --- requireArray ---

test("ValidationPipe.requireArray returns array", () => {
  assert.deepEqual(pipe.requireArray<number>({ items: [1, 2] }, "items"), [1, 2]);
});

test("ValidationPipe.requireArray rejects non-array", () => {
  assert.throws(
    () => pipe.requireArray({ items: "not-array" }, "items"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_BODY",
  );
});

// --- requireQueryString ---

test("ValidationPipe.requireQueryString returns value from query", () => {
  assert.equal(pipe.requireQueryString({ page: "2" }, "page"), "2");
});

test("ValidationPipe.requireQueryString rejects missing key", () => {
  assert.throws(
    () => pipe.requireQueryString({}, "page"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_QUERY",
  );
});

test("ValidationPipe.requireQueryString rejects undefined query", () => {
  assert.throws(
    () => pipe.requireQueryString(undefined, "page"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "REQ_INVALID_QUERY",
  );
});
