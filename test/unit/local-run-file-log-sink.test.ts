import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createLocalRunFileLogSink,
  shouldEnableLocalRunFileLogs,
} from "../../src/infrastructure/logging/local-run-file-log-sink.ts";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";

test("local run file logs are disabled unless explicitly enabled outside production", () => {
  assert.equal(shouldEnableLocalRunFileLogs({ NODE_ENV: "development" }), false);
  assert.equal(
    shouldEnableLocalRunFileLogs({
      NODE_ENV: "production",
      ZOOK_LOCAL_FILE_LOGS: "1",
    }),
    false,
  );
  assert.equal(
    shouldEnableLocalRunFileLogs({
      NODE_ENV: "development",
      APP_ENV: "online",
      ZOOK_LOCAL_FILE_LOGS: "1",
    }),
    false,
  );
  assert.equal(
    shouldEnableLocalRunFileLogs({
      NODE_ENV: "development",
      ZOOK_LOCAL_FILE_LOGS: "1",
    }),
    true,
  );
});

test("local run file sink writes one file per run with redacted records", () => {
  const root = mkdtempSync(join(tmpdir(), "zook-run-logs-"));
  test.after(() => rmSync(root, { recursive: true, force: true }));

  const first = createLocalRunFileLogSink({
    service: "api",
    logRoot: root,
    env: { NODE_ENV: "development", ZOOK_LOCAL_FILE_LOGS: "1" },
    now: () => new Date("2026-06-17T01:02:03.004Z"),
    pid: 111,
  });
  assert.ok(first);
  const logger = new StructuredLogger("api", {
    emitToConsole: false,
    sinks: [first.sink],
  });

  logger.info("request received", {
    requestId: "req_1",
    httpStatus: 503,
    authorization: "Bearer secret",
    nested: { accessToken: "secret-token", safe: "ok" },
  });

  const lines = readFileSync(first.currentPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).message, "logger_run_started");
  const record = JSON.parse(lines[1]);
  assert.equal(record.runId, first.runId);
  assert.equal(record.pid, 111);
  assert.equal(record.httpStatus, 503);
  assert.equal(record.authorization, "<redacted>");
  assert.deepEqual(record.nested, { accessToken: "<redacted>", safe: "ok" });

  const latest = JSON.parse(
    readFileSync(join(first.directory, "latest.json"), "utf8"),
  );
  assert.equal(latest.runId, first.runId);
  assert.equal(latest.path, first.currentPath);
});

test("local run file sink creates a new file for each process start", () => {
  const root = mkdtempSync(join(tmpdir(), "zook-run-logs-"));
  test.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { NODE_ENV: "development", ZOOK_LOCAL_FILE_LOGS: "1" };

  const first = createLocalRunFileLogSink({
    service: "api",
    logRoot: root,
    env,
    now: () => new Date("2026-06-17T01:02:03.004Z"),
    pid: 111,
  });
  const second = createLocalRunFileLogSink({
    service: "api",
    logRoot: root,
    env,
    now: () => new Date("2026-06-17T01:03:03.004Z"),
    pid: 222,
  });

  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.currentPath, second.currentPath);
  const ndjsonFiles = readdirSync(first.directory).filter((name) =>
    name.endsWith(".ndjson"),
  );
  assert.equal(ndjsonFiles.length, 2);
});

test("local run file sink disables itself when setup cannot write files", () => {
  const root = mkdtempSync(join(tmpdir(), "zook-run-logs-"));
  test.after(() => rmSync(root, { recursive: true, force: true }));
  const blockedRoot = join(root, "not-a-directory");
  writeFileSync(blockedRoot, "file blocks mkdir", "utf8");

  const sink = createLocalRunFileLogSink({
    service: "api",
    logRoot: blockedRoot,
    env: { NODE_ENV: "development", ZOOK_LOCAL_FILE_LOGS: "1" },
    now: () => new Date("2026-06-17T01:02:03.004Z"),
    pid: 111,
  });

  assert.equal(sink, undefined);
});
