import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { isContainerRuntime } from "../runtime/runtime-readiness.ts";

export const HOST_APP_RUN_DATA_ROOT = "/var/lib/zook/appRunData";
export const CONTAINER_APP_RUN_DATA_ROOT = "/app/appRunData";

export function resolvePersistentFileStorageRoot(insideContainer = isContainerRuntime()): string {
  return insideContainer ? CONTAINER_APP_RUN_DATA_ROOT : HOST_APP_RUN_DATA_ROOT;
}

export interface PersistentFileWriteResult {
  fileName: string;
  filePath: string;
  sizeBytes: number;
}

export class PersistentFileStore {
  constructor(private readonly rootDir = resolvePersistentFileStorageRoot()) {}

  get root(): string {
    return this.rootDir;
  }

  resolvePath(...segments: string[]): string {
    return resolve(this.rootDir, ...segments);
  }

  async ensureDirectory(...segments: string[]): Promise<string> {
    const dirPath = this.resolvePath(...segments);
    await mkdir(dirPath, { recursive: true });
    return dirPath;
  }

  async writeText(relativePath: string, content: string): Promise<PersistentFileWriteResult> {
    const filePath = this.resolvePath(relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    return {
      fileName: relativePath.split("/").at(-1) ?? relativePath,
      filePath,
      sizeBytes: Buffer.byteLength(content, "utf8"),
    };
  }

  async writeBuffer(relativePath: string, content: Buffer): Promise<PersistentFileWriteResult> {
    const filePath = this.resolvePath(relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    return {
      fileName: relativePath.split("/").at(-1) ?? relativePath,
      filePath,
      sizeBytes: content.length,
    };
  }

  async readText(filePath: string): Promise<string> {
    return await readFile(filePath, "utf8");
  }

  async stat(filePath: string) {
    return await stat(filePath);
  }
}

export async function assertPersistentFileStoreReady(rootDir = resolvePersistentFileStorageRoot()): Promise<void> {
  const store = new PersistentFileStore(rootDir);
  const randomToken = randomBytes(8).toString("hex");
  const relativePath = "hello_world.txt";
  const expected = `hello_world:${randomToken}`;
  const writeResult = await store.writeText(relativePath, expected);
  const actual = await store.readText(writeResult.filePath);

  if (actual !== expected) {
    throw new Error("Persistent file storage smoke test failed: content mismatch.");
  }
}
