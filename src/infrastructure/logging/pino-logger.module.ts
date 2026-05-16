import type { LogRecord } from "../../shared/types.ts";

type LoggerFormat = "json" | "pretty";

/**
 * StructuredLogger keeps the JSON logging contract close to nestjs-pino while staying dependency free.
 */
export class StructuredLogger {
  readonly records: LogRecord[] = [];

  constructor(
    private readonly service: string,
    private readonly options: {
      emitToConsole?: boolean;
      format?: LoggerFormat;
      color?: boolean;
    } = {},
  ) {}

  info(message: string, context: Omit<LogRecord, "timestamp" | "level" | "service" | "message"> = {}): void {
    this.write("info", message, context);
  }

  warn(message: string, context: Omit<LogRecord, "timestamp" | "level" | "service" | "message"> = {}): void {
    this.write("warn", message, context);
  }

  error(message: string, context: Omit<LogRecord, "timestamp" | "level" | "service" | "message"> = {}): void {
    this.write("error", message, context);
  }

  private write(
    level: LogRecord["level"],
    message: string,
    context: Omit<LogRecord, "timestamp" | "level" | "service" | "message">,
  ): void {
    const entry: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      ...context,
    };

    this.records.push(entry);

    if (this.options.emitToConsole !== false) {
      const format = this.options.format ?? resolveLoggerFormat();
      console.log(format === "pretty"
        ? formatPrettyLogRecord(entry, this.options.color ?? shouldColorizeLogs())
        : JSON.stringify(entry));
    }
  }
}

function resolveLoggerFormat(): LoggerFormat {
  return process.env.ZOOK_LOG_FORMAT === "pretty" ? "pretty" : "json";
}

function shouldColorizeLogs(): boolean {
  if (process.env.NO_COLOR || process.env.ZOOK_LOG_COLOR === "0") {
    return false;
  }
  return Boolean(process.env.FORCE_COLOR) || Boolean(process.stdout.isTTY);
}

function formatPrettyLogRecord(entry: LogRecord, colorEnabled: boolean): string {
  const header = [
    colorize(entry.timestamp, "dim", colorEnabled),
    colorize(entry.level.toUpperCase().padEnd(5), colorForLevel(entry.level), colorEnabled),
    colorize(entry.service, "magenta", colorEnabled),
    colorize(entry.message, "bold", colorEnabled),
  ].join(" ");
  const details = Object.entries(entry)
    .filter(([key]) => !["timestamp", "level", "service", "message"].includes(key))
    .map(([key, value]) => formatPrettyField(key, value, colorEnabled));

  return details.length > 0 ? `${header}\n${details.join("\n")}` : header;
}

function formatPrettyField(key: string, value: unknown, colorEnabled: boolean): string {
  const label = colorize(key, "cyan", colorEnabled);
  const formatted = formatPrettyValue(value, colorEnabled);
  if (formatted.includes("\n")) {
    return `  ${label}:\n${indent(formatted, 4)}`;
  }
  return `  ${label}: ${formatted}`;
}

function formatPrettyValue(value: unknown, colorEnabled: boolean): string {
  if (typeof value === "string") {
    return formatPrettyString(value, colorEnabled);
  }
  if (value && typeof value === "object") {
    return colorizeJson(JSON.stringify(value, null, 2), colorEnabled);
  }
  return colorizePrimitive(String(value), colorEnabled);
}

function formatPrettyString(value: string, colorEnabled: boolean): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
    || (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return colorizeJson(JSON.stringify(JSON.parse(trimmed), null, 2), colorEnabled);
    } catch {
      return value;
    }
  }
  return value;
}

function indent(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function colorForLevel(level: LogRecord["level"]): AnsiColor {
  if (level === "error") {
    return "red";
  }
  if (level === "warn") {
    return "yellow";
  }
  return "green";
}

function colorizeJson(json: string, enabled: boolean): string {
  if (!enabled) {
    return json;
  }
  return json.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (match: string, stringToken?: string, keySeparator?: string, primitiveToken?: string) => {
      if (stringToken) {
        return keySeparator
          ? `${colorize(stringToken, "blue", true)}${keySeparator}`
          : colorize(stringToken, "green", true);
      }
      return colorizePrimitive(primitiveToken ?? match, true);
    },
  );
}

function colorizePrimitive(value: string, enabled: boolean): string {
  if (!enabled) {
    return value;
  }
  if (value === "true" || value === "false") {
    return colorize(value, "yellow", true);
  }
  if (value === "null" || value === "undefined") {
    return colorize(value, "dim", true);
  }
  if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    return colorize(value, "yellow", true);
  }
  return value;
}

type AnsiColor = "blue" | "bold" | "cyan" | "dim" | "green" | "magenta" | "red" | "yellow";

const ANSI_CODES: Record<AnsiColor, [number, number]> = {
  blue: [34, 39],
  bold: [1, 22],
  cyan: [36, 39],
  dim: [2, 22],
  green: [32, 39],
  magenta: [35, 39],
  red: [31, 39],
  yellow: [33, 39],
};

function colorize(value: string, color: AnsiColor, enabled: boolean): string {
  if (!enabled) {
    return value;
  }
  const [open, close] = ANSI_CODES[color];
  return `\u001B[${open}m${value}\u001B[${close}m`;
}
