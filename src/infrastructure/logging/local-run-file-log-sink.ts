import { appendFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { LogRecord } from "../../shared/types.ts";
import type { LogSink } from "./pino-logger.module.ts";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_RETAIN_RUNS = 20;

export interface LocalRunFileLogSinkOptions {
  service: string;
  logRoot?: string;
  maxBytes?: number;
  retainRuns?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  now?: () => Date;
  pid?: number;
}

export interface LocalRunFileLogSinkResult {
  sink: LogSink;
  runId: string;
  directory: string;
  currentPath: string;
}

export function createLocalRunFileLogSink(
  options: LocalRunFileLogSinkOptions,
): LocalRunFileLogSinkResult | undefined {
  const env = options.env ?? process.env;
  if (!shouldEnableLocalRunFileLogs(env)) {
    return undefined;
  }

  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const pid = options.pid ?? process.pid;
  const runId = `${sanitizeFilePart(startedAt)}-pid${pid}`;
  const logRoot = options.logRoot ?? env.ZOOK_LOG_DIR ?? join(options.cwd ?? process.cwd(), ".zook", "logs");
  const directory = join(logRoot, sanitizeFilePart(options.service));
  try {
    mkdirSync(directory, { recursive: true });

    const writer = new LocalRunFileLogWriter({
      directory,
      runId,
      service: options.service,
      startedAt,
      pid,
      maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
      retainRuns: options.retainRuns ?? DEFAULT_RETAIN_RUNS,
      env,
      cwd: options.cwd ?? process.cwd(),
    });
    writer.writeRunStarted();
    writer.writeLatest();
    writer.cleanupOldRuns();

    return {
      sink: (entry) => writer.write(entry),
      runId,
      directory,
      currentPath: writer.currentPath,
    };
  } catch {
    return undefined;
  }
}

export function shouldEnableLocalRunFileLogs(env: NodeJS.ProcessEnv = process.env): boolean {
  const appEnv = String(env.APP_ENV ?? "").trim().toLowerCase();
  const nodeEnv = String(env.NODE_ENV ?? "").trim().toLowerCase();
  const isProductionLike =
    nodeEnv === "production" ||
    appEnv === "online" ||
    appEnv === "production" ||
    appEnv === "prod";
  return !isProductionLike && env.ZOOK_LOCAL_FILE_LOGS === "1";
}

class LocalRunFileLogWriter {
  private part = 1;
  private bytesWritten = 0;
  private disabled = false;

  constructor(
    private readonly options: {
      directory: string;
      runId: string;
      service: string;
      startedAt: string;
      pid: number;
      maxBytes: number;
      retainRuns: number;
      env: NodeJS.ProcessEnv;
      cwd: string;
    },
  ) {}

  get currentPath(): string {
    return join(this.options.directory, `${this.options.runId}-part-${this.part}.ndjson`);
  }

  writeRunStarted(): void {
    this.writeRaw({
      timestamp: this.options.startedAt,
      level: "info",
      service: this.options.service,
      message: "logger_run_started",
      runId: this.options.runId,
      pid: this.options.pid,
      startedAt: this.options.startedAt,
      nodeEnv: this.options.env.NODE_ENV,
      appEnv: this.options.env.APP_ENV,
      port: this.options.env.PORT,
      cwd: this.options.cwd,
      gitSha: this.options.env.GIT_SHA,
    });
  }

  writeLatest(): void {
    writeFileSync(
      join(this.options.directory, "latest.json"),
      `${JSON.stringify({
        runId: this.options.runId,
        startedAt: this.options.startedAt,
        pid: this.options.pid,
        service: this.options.service,
        path: this.currentPath,
      }, null, 2)}\n`,
      "utf8",
    );
  }

  cleanupOldRuns(): void {
    const entries = readdirSync(this.options.directory)
      .filter((name) => name.endsWith(".ndjson"))
      .map((name) => ({
        name,
        runKey: name.replace(/-part-\d+\.ndjson$/, ""),
      }));
    const runKeys = Array.from(new Set(entries.map((entry) => entry.runKey))).sort().reverse();
    const staleRunKeys = new Set(runKeys.slice(this.options.retainRuns));
    for (const entry of entries) {
      if (staleRunKeys.has(entry.runKey)) {
        rmSync(join(this.options.directory, entry.name), { force: true });
      }
    }
  }

  write(entry: LogRecord): void {
    this.writeRaw({
      ...redactLogRecord(entry),
      runId: this.options.runId,
      pid: this.options.pid,
      startedAt: this.options.startedAt,
    });
  }

  private writeRaw(entry: Record<string, unknown>): void {
    if (this.disabled) {
      return;
    }
    const line = `${JSON.stringify(entry)}\n`;
    try {
      if (this.bytesWritten > 0 && this.bytesWritten + Buffer.byteLength(line) > this.options.maxBytes) {
        this.part += 1;
        this.bytesWritten = 0;
        this.writeLatest();
      }
      appendFileSync(this.currentPath, line, "utf8");
      this.bytesWritten += Buffer.byteLength(line);
    } catch {
      this.disabled = true;
    }
  }
}

function redactLogRecord(entry: LogRecord): Record<string, unknown> {
  return redactValue(entry) as Record<string, unknown>;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        isSensitiveKey(key) ? "<redacted>" : redactValue(nested),
      ]),
    );
  }
  return value;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [
    "authorization",
    "accesstoken",
    "refreshtoken",
    "claimtoken",
    "password",
    "token",
    "secret",
    "code",
  ].some((fragment) => normalized.includes(fragment));
}

function sanitizeFilePart(value: string): string {
  return basename(value.replace(/[:.]/g, "-").replace(/[^a-zA-Z0-9_-]/g, "_"));
}
