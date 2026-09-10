import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const AI_NOVEL_TRACE_KINDS = [
  "kickoff",
  "import_book",
  "imported_kickoff",
  "writing",
  "history_qa",
  "advance_chapter",
] as const;

export const AI_NOVEL_TRACE_STATUSES = [
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export type AiNovelTraceKind = (typeof AI_NOVEL_TRACE_KINDS)[number];
export type AiNovelTraceStatus = (typeof AI_NOVEL_TRACE_STATUSES)[number];

export interface AiNovelDebugTraceManifest {
  sessionId: string;
  /** Authenticated AINovel user that owns this local-debug trace. */
  uid?: string;
  kind: AiNovelTraceKind;
  status: AiNovelTraceStatus;
  bookId?: string;
  chapterId?: string;
  title?: string;
  captureCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiNovelDebugTraceCapture {
  capturedAt: string;
  status: AiNovelTraceStatus;
  trace: Record<string, unknown>;
}

export interface AiNovelDebugTraceSession {
  manifest: AiNovelDebugTraceManifest;
  captures: AiNovelDebugTraceCapture[];
}

export interface AiNovelDebugTraceWriteCommand {
  sessionId: string;
  uid?: string;
  kind: AiNovelTraceKind;
  status: AiNovelTraceStatus;
  bookId?: string;
  chapterId?: string;
  title?: string;
  trace: Record<string, unknown>;
}

export interface AiNovelDebugTraceFilter {
  uid?: string;
  /** `cid` is the UI/API alias for the existing session id. */
  cid?: string;
  kind?: AiNovelTraceKind;
  status?: AiNovelTraceStatus;
  bookId?: string;
  chapterId?: string;
  query?: string;
}

const DEFAULT_TRACE_ROOT = join(process.cwd(), ".zook", "ai-novel-traces");
const MAX_TRACE_BYTES = 12 * 1024 * 1024;

/** Local-development trace store. One session retains every uploaded turn. */
export class AiNovelDebugTraceService {
  private readonly writes = new Map<string, Promise<void>>();

  constructor(
    private readonly rootPath = DEFAULT_TRACE_ROOT,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async write(command: AiNovelDebugTraceWriteCommand): Promise<AiNovelDebugTraceManifest> {
    const sessionId = normalizeSessionId(command.sessionId);
    const storageKey = this.storageKey(command.kind, sessionId);
    this.assertTraceSize(command.trace);
    return await this.enqueue(storageKey, async () => {
      const directory = join(this.rootPath, storageKey);
      await mkdir(directory, { recursive: true });
      const current = await this.readDirectoryOrNull(storageKey);
      const timestamp = this.now().toISOString();
      const captures: AiNovelDebugTraceCapture[] = [
        ...(current?.captures ?? []),
        { capturedAt: timestamp, status: command.status, trace: command.trace },
      ];
      const bookId = normalizeOptional(command.bookId) ?? current?.manifest.bookId;
      const chapterId = normalizeOptional(command.chapterId) ?? current?.manifest.chapterId;
      const title = normalizeOptional(command.title) ?? current?.manifest.title;
      const uid = normalizeOptional(command.uid) ?? current?.manifest.uid;
      const manifest: AiNovelDebugTraceManifest = {
        sessionId,
        ...(uid ? { uid } : {}),
        kind: command.kind,
        status: command.status,
        ...(bookId ? { bookId } : {}),
        ...(chapterId ? { chapterId } : {}),
        ...(title ? { title } : {}),
        captureCount: captures.length,
        createdAt: current?.manifest.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      await Promise.all([
        this.writeJsonAtomic(join(directory, "trace.json"), { captures }),
        this.writeJsonAtomic(join(directory, "manifest.json"), manifest),
      ]);
      return manifest;
    });
  }

  async list(filter: AiNovelDebugTraceFilter = {}): Promise<AiNovelDebugTraceManifest[]> {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(this.rootPath, { withFileTypes: true });
    } catch (error: unknown) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    const manifests = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => await this.readManifestOrNull(entry.name)),
    );
    return manifests
      .filter((item): item is AiNovelDebugTraceManifest => item !== null)
      .filter((item) => matchesFilter(item, filter))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async read(
    sessionId: string,
    kind?: AiNovelTraceKind,
  ): Promise<AiNovelDebugTraceSession> {
    const normalized = normalizeSessionId(sessionId);
    const session = kind
      ? await this.readDirectoryOrNull(this.storageKey(kind, normalized))
      : await this.readLatestBySessionId(normalized);
    if (!session) {
      const error = new Error("Trace session not found.") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return session;
  }

  private storageKey(kind: AiNovelTraceKind, sessionId: string): string {
    const digest = createHash("sha256").update(sessionId, "utf8").digest("hex");
    return `${kind}--${digest}`;
  }

  private async enqueue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(sessionId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const next = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => next);
    this.writes.set(sessionId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.writes.get(sessionId) === queued) this.writes.delete(sessionId);
    }
  }

  private async readLatestBySessionId(
    sessionId: string,
  ): Promise<AiNovelDebugTraceSession | null> {
    const matches = (await this.list({ query: sessionId }))
      .filter((manifest) => manifest.sessionId === sessionId);
    if (matches.length === 0) return null;
    return await this.readDirectoryOrNull(
      this.storageKey(matches[0]!.kind, sessionId),
    );
  }

  private async readDirectoryOrNull(
    directoryName: string,
  ): Promise<AiNovelDebugTraceSession | null> {
    try {
      const directory = join(this.rootPath, directoryName);
      const [manifestRaw, traceRaw] = await Promise.all([
        readFile(join(directory, "manifest.json"), "utf8"),
        readFile(join(directory, "trace.json"), "utf8"),
      ]);
      const manifest = parseManifest(JSON.parse(manifestRaw));
      const captures = parseCaptures(JSON.parse(traceRaw));
      return manifest && captures ? { manifest, captures } : null;
    } catch (error: unknown) {
      if (isMissingFile(error) || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  private async readManifestOrNull(
    directoryName: string,
  ): Promise<AiNovelDebugTraceManifest | null> {
    try {
      const raw = await readFile(
        join(this.rootPath, directoryName, "manifest.json"),
        "utf8",
      );
      return parseManifest(JSON.parse(raw));
    } catch (error: unknown) {
      if (isMissingFile(error) || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  private async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value), "utf8");
    await rename(temporary, path);
  }

  private assertTraceSize(trace: Record<string, unknown>): void {
    if (Buffer.byteLength(JSON.stringify(trace), "utf8") > MAX_TRACE_BYTES) {
      throw new RangeError("Trace payload exceeds the 12 MiB local-debug limit.");
    }
  }
}

function matchesFilter(item: AiNovelDebugTraceManifest, filter: AiNovelDebugTraceFilter): boolean {
  if (filter.uid && item.uid !== filter.uid) return false;
  if (filter.cid && item.sessionId !== filter.cid) return false;
  if (filter.kind && item.kind !== filter.kind) return false;
  if (filter.status && item.status !== filter.status) return false;
  if (filter.bookId && item.bookId !== filter.bookId) return false;
  if (filter.chapterId && item.chapterId !== filter.chapterId) return false;
  const query = normalizeOptional(filter.query)?.toLocaleLowerCase();
  if (!query) return true;
  return [item.sessionId, item.title, item.bookId, item.chapterId, item.kind]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase().includes(query));
}

function parseManifest(value: unknown): AiNovelDebugTraceManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.sessionId !== "string" ||
    !AI_NOVEL_TRACE_KINDS.includes(item.kind as AiNovelTraceKind) ||
    !AI_NOVEL_TRACE_STATUSES.includes(item.status as AiNovelTraceStatus) ||
    !Number.isInteger(item.captureCount) ||
    (item.captureCount as number) < 0 ||
    typeof item.createdAt !== "string" ||
    typeof item.updatedAt !== "string"
  ) return null;
  return {
    sessionId: item.sessionId,
    ...(typeof item.uid === "string" ? { uid: item.uid } : {}),
    kind: item.kind as AiNovelTraceKind,
    status: item.status as AiNovelTraceStatus,
    ...(typeof item.bookId === "string" ? { bookId: item.bookId } : {}),
    ...(typeof item.chapterId === "string" ? { chapterId: item.chapterId } : {}),
    ...(typeof item.title === "string" ? { title: item.title } : {}),
    captureCount: item.captureCount as number,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function parseCaptures(value: unknown): AiNovelDebugTraceCapture[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const captures = (value as Record<string, unknown>).captures;
  if (!Array.isArray(captures)) return null;
  const parsed = captures.filter((capture): capture is AiNovelDebugTraceCapture => {
    if (!capture || typeof capture !== "object" || Array.isArray(capture)) return false;
    const item = capture as Record<string, unknown>;
    return typeof item.capturedAt === "string" &&
      AI_NOVEL_TRACE_STATUSES.includes(item.status as AiNovelTraceStatus) &&
      Boolean(item.trace && typeof item.trace === "object" && !Array.isArray(item.trace));
  });
  return parsed.length === captures.length ? parsed : null;
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeSessionId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new RangeError("Trace session id is required.");
  if (Buffer.byteLength(normalized, "utf8") > 1024) {
    throw new RangeError("Trace session id exceeds the 1 KiB limit.");
  }
  return normalized;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
