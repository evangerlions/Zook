import assert from "node:assert/strict";
import test from "node:test";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";

function captureConsoleLog(run: () => void): string[] {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (value?: unknown) => {
    lines.push(String(value));
  };
  try {
    run();
  } finally {
    console.log = originalLog;
  }
  return lines;
}

test("structured logger pretty-prints tiny provider stream deltas for local readability", () => {
  const logger = new StructuredLogger("api", {
    format: "pretty",
    color: false,
  });

  const lines = captureConsoleLog(() => {
    logger.info("ai_novel local provider stream delta", {
      preview: "[reasoning +]第二剑擦着他的",
    });
  });

  assert.equal(lines.length, 1);
  assert.match(lines[0], /INFO\s+ api ai_novel local provider stream delta/);
  assert.match(lines[0], /preview: \[reasoning \+\]第二剑擦着他的/);
  assert.doesNotMatch(lines[0], /modelKey:/);
  assert.doesNotMatch(lines[0], /kind:/);
  assert.doesNotMatch(lines[0], /deltaLength:/);
});

test("structured logger colors pretty output by log level when enabled", () => {
  const logger = new StructuredLogger("api", {
    format: "pretty",
    color: true,
  });

  const lines = captureConsoleLog(() => {
    logger.warn("something needs attention");
  });

  assert.match(lines[0], /\u001B\[33mWARN\s+\u001B\[39m/);
  assert.match(lines[0], /\u001B\[35mapi\u001B\[39m/);
  assert.match(lines[0], /\u001B\[1msomething needs attention\u001B\[22m/);
});

test("structured logger colorizes pretty JSON keys strings and primitives", () => {
  const logger = new StructuredLogger("api", {
    format: "pretty",
    color: true,
  });

  const lines = captureConsoleLog(() => {
    logger.info("json payload", {
      chunk: '{"text":"hello","count":2,"ok":true,"value":null}',
    });
  });

  assert.match(lines[0], /\u001B\[34m"text"\u001B\[39m:/);
  assert.match(lines[0], /\u001B\[32m"hello"\u001B\[39m/);
  assert.match(lines[0], /\u001B\[33m2\u001B\[39m/);
  assert.match(lines[0], /\u001B\[33mtrue\u001B\[39m/);
  assert.match(lines[0], /\u001B\[2mnull\u001B\[22m/);
});
