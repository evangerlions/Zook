import type { LogRecord } from "../../shared/types.ts";

/**
 * StructuredLogger keeps the JSON logging contract close to nestjs-pino while staying dependency free.
 */
export class StructuredLogger {
  readonly records: LogRecord[] = [];

  constructor(
    private readonly service: string,
    private readonly options: { emitToConsole?: boolean } = {},
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
      console.log(JSON.stringify(entry));
    }
  }
}
